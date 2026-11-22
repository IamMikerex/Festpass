"""
Read-only analytics: dashboard KPIs, per-festival reports, the payment ledger,
gate-scan and transfer audit trails, reconciliation (rule 13) and CSV exports.
Every figure is computed from base tables and views at query time (Part 2 b).

Scope: an ORGANIZER sees only festivals they run; the AUDITOR sees all of them.
"""
import csv
import io
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from ..db import snapshot
from ..errors import Forbidden, NotFound
from ..security import Staff

router = APIRouter(prefix="/analytics", tags=["analytics"])

Fmt = Literal["json", "csv"] | None


def scope(user, alias="f"):
    if user["role"] == "AUDITOR":
        return "1=1", []
    return f"{alias}.organizer_id = %s", [user["user_id"]]


def filters(user, conditions):
    """Scope plus every condition whose value is set; a condition with %s binds that value."""
    sql, params = scope(user)
    clauses = [sql]
    for clause, value in conditions.items():
        if value:
            clauses.append(clause)
            params += [value] if "%s" in clause else []
    return " AND ".join(clauses), params


def festival_or_403(s, user, festival_id):
    f = s.fetch_one("SELECT * FROM Festivals WHERE festival_id = %s", (festival_id,))
    if not f:
        raise NotFound("Festival not found")
    if user["role"] == "ORGANIZER" and f["organizer_id"] != user["user_id"]:
        raise Forbidden("You do not have permission to do this")
    return f


def maybe_csv(rows, fmt, filename, key):
    if fmt != "csv":
        return {key: rows}
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )


# ---------------------------------------------------------------- dashboard
@router.get("/dashboard")
def dashboard(user: Staff):
    s_sql, s_params = scope(user, "s")
    f_sql, f_params = scope(user)
    with snapshot() as s:
        festivals = s.fetch_all(f"SELECT * FROM v_festival_stats s WHERE {s_sql} ORDER BY s.start_date", s_params)
        money = s.fetch_one(f"""
            SELECT COALESCE(SUM(CASE WHEN p.payment_type='CHARGE' THEN p.amount END),0) AS gross,
                   COALESCE(SUM(CASE WHEN p.payment_type='REFUND' THEN p.amount END),0) AS refunds,
                   COUNT(CASE WHEN p.payment_type='REFUND' THEN 1 END) AS refund_count
              FROM Payments p
              LEFT JOIN Orders o ON o.order_id = p.order_id
              LEFT JOIN StallAllocations a ON a.allocation_id = p.allocation_id
              LEFT JOIN Stalls st ON st.stall_id = a.stall_id
              JOIN Festivals f ON f.festival_id = COALESCE(o.festival_id, st.festival_id)
             WHERE p.status = 'CAPTURED' AND {f_sql}""", f_params)
        daily = s.fetch_all(f"""
            SELECT DATE(p.processed_at) AS day,
                   SUM(CASE WHEN p.payment_type='CHARGE' THEN p.amount ELSE 0 END) AS revenue,
                   SUM(CASE WHEN p.payment_type='REFUND' THEN p.amount ELSE 0 END) AS refunds,
                   COUNT(DISTINCT CASE WHEN p.payment_type='CHARGE' THEN p.order_id END) AS orders
              FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
             WHERE p.status = 'CAPTURED' AND p.processed_at >= CURDATE() - INTERVAL 29 DAY AND {f_sql}
             GROUP BY DATE(p.processed_at) ORDER BY day""", f_params)
        methods = s.fetch_all(f"""
            SELECT p.method, COUNT(*) AS n, SUM(p.amount) AS amount
              FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
             WHERE p.status = 'CAPTURED' AND p.payment_type = 'CHARGE' AND {f_sql} GROUP BY p.method""", f_params)
        pending_apps = s.fetch_one(f"""
            SELECT COUNT(*) AS n FROM StallAllocations a JOIN Stalls st ON st.stall_id = a.stall_id
              JOIN Festivals f ON f.festival_id = st.festival_id WHERE a.status = 'APPLIED' AND {f_sql}""", f_params)
        pending_vendors = s.fetch_one("SELECT COUNT(*) AS n FROM Vendors WHERE status = 'PENDING_REVIEW'")
        transfers = s.fetch_one(f"""
            SELECT COUNT(*) AS n FROM TicketTransfers tt JOIN Tickets tk ON tk.ticket_id = tt.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
             WHERE {f_sql}""", f_params)
        recent = s.fetch_all(f"""
            SELECT o.order_id, o.status, o.created_at, u.full_name AS buyer_name, f.name AS festival_name,
                   ot.ticket_count, ot.total_amount
              FROM Orders o JOIN v_order_totals ot ON ot.order_id = o.order_id
              JOIN Users u ON u.user_id = o.buyer_id JOIN Festivals f ON f.festival_id = o.festival_id
             WHERE {f_sql} ORDER BY o.created_at DESC LIMIT 8""", f_params)

    total = lambda k: sum(float(f[k] or 0) for f in festivals)  # noqa: E731
    return {
        "totals": {
            "festivals": len(festivals),
            "live": sum(1 for f in festivals if f["status"] == "LIVE"),
            "on_sale": sum(1 for f in festivals if f["status"] == "ON_SALE"),
            "tickets_sold": int(total("tickets_sold")),
            "checked_in": int(total("checked_in")),
            "ticket_revenue": total("ticket_revenue"),
            "stall_revenue": total("stall_revenue"),
            "gross": money["gross"], "refunds": money["refunds"], "refund_count": money["refund_count"],
            "net": money["gross"] - money["refunds"],
            "pending_applications": pending_apps["n"],
            "pending_vendors": pending_vendors["n"],
            "transfers": transfers["n"],
        },
        "festivals": festivals, "daily": daily, "methods": methods, "recent_orders": recent,
    }


# ----------------------------------------------------------- festival report
@router.get("/festivals/{festival_id}/report")
def festival_report(user: Staff, festival_id: int):
    with snapshot() as s:
        festival_or_403(s, user, festival_id)
        p = (festival_id,)
        stats = s.fetch_one("SELECT * FROM v_festival_stats WHERE festival_id = %s", p)
        tiers = s.fetch_all("""
            SELECT a.*, COALESCE(r.revenue, 0) AS revenue FROM v_tier_availability a
              LEFT JOIN (SELECT tk.tier_id, SUM(t.price) AS revenue FROM Tickets tk
                           JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Orders o ON o.order_id = tk.order_id
                          WHERE o.status = 'PAID' AND tk.status IN ('VALID','CHECKED_IN') GROUP BY tk.tier_id) r
                ON r.tier_id = a.tier_id
             WHERE a.festival_id = %s ORDER BY a.price""", p)
        daily = s.fetch_all("""
            SELECT DATE(o.paid_at) AS day, COUNT(tk.ticket_id) AS tickets, SUM(t.price) AS revenue
              FROM Orders o JOIN Tickets tk ON tk.order_id = o.order_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE o.festival_id = %s AND o.paid_at IS NOT NULL GROUP BY DATE(o.paid_at) ORDER BY day""", p)
        gates = s.fetch_all("""
            SELECT gs.gate_code,
                   SUM(gs.direction='IN' AND gs.result='ACCEPTED') AS entries,
                   SUM(gs.direction='OUT' AND gs.result='ACCEPTED') AS exits,
                   SUM(gs.result<>'ACCEPTED') AS rejected
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE t.festival_id = %s GROUP BY gs.gate_code ORDER BY gs.gate_code""", p)
        rejections = s.fetch_all("""
            SELECT gs.result, COUNT(*) AS n
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE t.festival_id = %s GROUP BY gs.result""", p)
        hourly = s.fetch_all("""
            SELECT DATE_FORMAT(gs.scanned_at, '%%Y-%%m-%%d %%H:00') AS hour,
                   SUM(gs.direction='IN' AND gs.result='ACCEPTED') AS entries,
                   SUM(gs.direction='OUT' AND gs.result='ACCEPTED') AS exits,
                   SUM(gs.result<>'ACCEPTED') AS rejected
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE t.festival_id = %s GROUP BY hour ORDER BY hour""", p)
        inside = s.fetch_one("""
            SELECT COUNT(*) AS n FROM v_ticket_last_scan ls JOIN Tickets tk ON tk.ticket_id = ls.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = %s AND ls.direction = 'IN'""", p)
        orders = s.fetch_one("""
            SELECT COUNT(*) AS total, COALESCE(SUM(status='PAID'),0) AS paid, COALESCE(SUM(status='PENDING'),0) AS pending,
                   COALESCE(SUM(status='EXPIRED'),0) AS expired, COALESCE(SUM(status='CANCELLED'),0) AS cancelled,
                   COALESCE(SUM(status='REFUNDED'),0) AS refunded
              FROM Orders WHERE festival_id = %s""", p)
        refunds = s.fetch_one("""
            SELECT COUNT(*) AS n, COALESCE(SUM(p.amount),0) AS amount FROM Payments p JOIN Orders o ON o.order_id = p.order_id
             WHERE o.festival_id = %s AND p.payment_type = 'REFUND' AND p.status = 'CAPTURED'""", p)
        stalls = s.fetch_all("""
            SELECT s.zone, COUNT(*) AS stalls, SUM(a.allocation_id IS NOT NULL) AS allocated,
                   COALESCE(SUM(a.agreed_fee), 0) AS contracted_fees
              FROM Stalls s LEFT JOIN StallAllocations a ON a.stall_id = s.stall_id AND a.status = 'APPROVED'
             WHERE s.festival_id = %s GROUP BY s.zone""", p)
    return {"stats": stats, "tiers": tiers, "daily": daily, "gates": gates, "rejections": rejections,
            "hourly": hourly, "inside_now": inside["n"], "orders": orders, "refunds": refunds, "stalls": stalls}


@router.get("/festivals/{festival_id}/attendees")
def attendees(user: Staff, festival_id: int, q: str | None = None,
              status: Literal["VALID", "CHECKED_IN", "REFUNDED", "VOID"] | None = None,
              format: Fmt = None):
    sql = """
        SELECT tk.ticket_id, t.tier_name, t.price, tk.status AS ticket_status, o.order_id, o.status AS order_status,
               hu.full_name AS holder_name, hu.email AS holder_email, bu.full_name AS buyer_name,
               TIMESTAMPDIFF(YEAR, hu.date_of_birth, f.start_date) AS age_at_start,
               (SELECT COUNT(*) FROM TicketTransfers tt WHERE tt.ticket_id = tk.ticket_id) AS transferred,
               ls.direction AS last_scan, ls.scanned_at AS last_scan_at, tk.issued_at
          FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
          JOIN Orders o ON o.order_id = tk.order_id JOIN Users hu ON hu.user_id = tk.holder_id
          JOIN Users bu ON bu.user_id = o.buyer_id
          LEFT JOIN v_ticket_last_scan ls ON ls.ticket_id = tk.ticket_id
         WHERE t.festival_id = %s AND o.status IN ('PAID','REFUNDED','CANCELLED')"""
    params = [festival_id]
    if q:
        sql += " AND (hu.full_name LIKE %s OR hu.email LIKE %s OR tk.ticket_id LIKE %s)"
        params += [f"%{q}%", f"%{q}%", f"{q}%"]
    if status:
        sql += " AND tk.status = %s"
        params.append(status)
    sql += " ORDER BY hu.full_name LIMIT 2000"
    with snapshot() as s:
        festival_or_403(s, user, festival_id)
        rows = s.fetch_all(sql, params)
    return maybe_csv(rows, format, f"attendees-festival-{festival_id}", "attendees")


# ------------------------------------------------------------ ledgers/audit
@router.get("/payments")
def payments(user: Staff, festival_id: int | None = None,
             type: Literal["CHARGE", "REFUND"] | None = None,
             status: Literal["AUTHORIZED", "CAPTURED", "FAILED"] | None = None,
             context: Literal["TICKET_ORDER", "STALL_FEE"] | None = None,
             date_from: str | None = Query(default=None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
             date_to: str | None = Query(default=None, alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
             format: Fmt = None):
    where, params = filters(user, {
        "f.festival_id = %s": festival_id,
        "p.payment_type = %s": type,
        "p.status = %s": status,
        "p.order_id IS NOT NULL": context == "TICKET_ORDER",
        "p.allocation_id IS NOT NULL": context == "STALL_FEE",
        "p.processed_at >= %s": date_from,
        "p.processed_at < %s + INTERVAL 1 DAY": date_to,
    })
    with snapshot() as s:
        rows = s.fetch_all(f"""
            SELECT p.payment_id, p.processed_at, p.payment_type, p.status, p.amount, p.currency, p.method, p.provider_ref,
                   p.order_id, p.allocation_id, IF(p.order_id IS NULL, 'STALL_FEE', 'TICKET_ORDER') AS context,
                   f.festival_id, f.name AS festival_name, COALESCE(bu.full_name, v.legal_name) AS counterparty
              FROM Payments p
              LEFT JOIN Orders o ON o.order_id = p.order_id
              LEFT JOIN Users bu ON bu.user_id = o.buyer_id
              LEFT JOIN StallAllocations a ON a.allocation_id = p.allocation_id
              LEFT JOIN Vendors v ON v.vendor_id = a.vendor_id
              LEFT JOIN Stalls st ON st.stall_id = a.stall_id
              JOIN Festivals f ON f.festival_id = COALESCE(o.festival_id, st.festival_id)
             WHERE {where}
             ORDER BY p.processed_at DESC, p.payment_id DESC LIMIT 1000""", params)
    return maybe_csv(rows, format, "payments", "payments")


@router.get("/reconciliation")
def reconciliation(user: Staff, show: Literal["all"] | None = None):
    """Rule 13 check: compares each order's tickets with its CHARGE/REFUND rows."""
    f_sql, params = scope(user)
    with snapshot() as s:
        rows = s.fetch_all(f"""
            SELECT ot.order_id, ot.status, f.name AS festival_name, ot.ticket_count, ot.total_amount,
                   ot.captured_amount, ot.refunded_amount,
                   CASE WHEN ot.status = 'PAID' AND ot.captured_amount < ot.total_amount THEN 'UNDERPAID'
                        WHEN ot.status IN ('EXPIRED','CANCELLED') AND ot.captured_amount > ot.refunded_amount THEN 'CAPTURED_ON_DEAD_ORDER'
                        WHEN ot.refunded_amount > ot.captured_amount THEN 'OVER_REFUNDED'
                        ELSE 'OK' END AS verdict
              FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id
             WHERE {f_sql}
            HAVING verdict <> 'OK' OR %s = 'all'
             ORDER BY ot.order_id DESC LIMIT 500""", params + [show or ""])
        summary = s.fetch_one(f"""
            SELECT COUNT(*) AS orders, COALESCE(SUM(ot.captured_amount),0) AS captured,
                   COALESCE(SUM(ot.refunded_amount),0) AS refunded,
                   COALESCE(SUM(ot.status='PAID'),0) AS paid_orders
              FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id WHERE {f_sql}""", params)
        stall = s.fetch_one(f"""
            SELECT COALESCE(SUM(b.paid_amount),0) AS fees_captured, COALESCE(SUM(b.refunded_amount),0) AS fees_refunded,
                   COALESCE(SUM(a.status='APPROVED' AND b.paid_amount < a.agreed_fee),0) AS fees_outstanding
              FROM v_allocation_balance b JOIN StallAllocations a ON a.allocation_id = b.allocation_id
              JOIN Stalls s ON s.stall_id = a.stall_id JOIN Festivals f ON f.festival_id = s.festival_id
             WHERE {f_sql}""", params)
    return {"issues": rows, "summary": {**summary, **stall}}


@router.get("/transfers")
def transfers(user: Staff, format: Fmt = None):
    f_sql, params = scope(user)
    with snapshot() as s:
        rows = s.fetch_all(f"""
            SELECT tt.transfer_id, tt.transferred_at, tt.ticket_id, t.tier_name, f.name AS festival_name,
                   fu.full_name AS from_name, fu.email AS from_email, tu.full_name AS to_name, tu.email AS to_email
              FROM TicketTransfers tt JOIN Tickets tk ON tk.ticket_id = tt.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
              JOIN Users fu ON fu.user_id = tt.from_user_id JOIN Users tu ON tu.user_id = tt.to_user_id
             WHERE {f_sql} ORDER BY tt.transferred_at DESC LIMIT 1000""", params)
    return maybe_csv(rows, format, "transfers", "transfers")


@router.get("/scans")
def scans(user: Staff, festival_id: int | None = None,
          result: Literal["ACCEPTED", "REJECTED_DUPLICATE", "REJECTED_INVALID", "REJECTED_NOT_LIVE"] | None = None,
          ticket_id: str | None = Query(default=None, pattern=r"^[0-9a-fA-F-]{36}$"),
          format: Fmt = None):
    where, params = filters(user, {
        "f.festival_id = %s": festival_id,
        "gs.result = %s": result,
        "gs.ticket_id = %s": ticket_id,
    })
    with snapshot() as s:
        rows = s.fetch_all(f"""
            SELECT gs.scan_id, gs.scanned_at, gs.gate_code, gs.direction, gs.result, gs.ticket_id,
                   hu.full_name AS holder_name, su.full_name AS staff_name, t.tier_name, f.name AS festival_name
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
              JOIN Festivals f ON f.festival_id = t.festival_id JOIN Users hu ON hu.user_id = tk.holder_id
              JOIN Users su ON su.user_id = gs.staff_id
             WHERE {where} ORDER BY gs.scanned_at DESC LIMIT 1000""", params)
    return maybe_csv(rows, format, "gate-scans", "scans")


@router.get("/tickets/{ticket_id}/trail")
def ticket_trail(user: Staff, ticket_id: str):
    """Who bought it, who received it, where and when it was scanned (problem: no audit trail)."""
    with snapshot() as s:
        tk = s.fetch_one("""
            SELECT tk.ticket_id, tk.status, tk.issued_at, t.tier_name, t.price, f.festival_id, f.name AS festival_name,
                   f.organizer_id, o.order_id, o.status AS order_status, o.created_at AS ordered_at, o.paid_at,
                   bu.full_name AS buyer_name, bu.email AS buyer_email, hu.full_name AS holder_name, hu.email AS holder_email
              FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
              JOIN Orders o ON o.order_id = tk.order_id JOIN Users bu ON bu.user_id = o.buyer_id
              JOIN Users hu ON hu.user_id = tk.holder_id
             WHERE tk.ticket_id = %s""", (ticket_id,))
        if not tk:
            raise NotFound("Ticket not found")
        if user["role"] == "ORGANIZER" and tk["organizer_id"] != user["user_id"]:
            raise Forbidden("You do not have permission to do this")
        transfers_ = s.fetch_all("""
            SELECT tt.transferred_at, fu.full_name AS from_name, tu.full_name AS to_name FROM TicketTransfers tt
              JOIN Users fu ON fu.user_id = tt.from_user_id JOIN Users tu ON tu.user_id = tt.to_user_id
             WHERE tt.ticket_id = %s""", (ticket_id,))
        scans_ = s.fetch_all("""
            SELECT gs.scanned_at, gs.gate_code, gs.direction, gs.result, su.full_name AS staff_name FROM GateScans gs
              JOIN Users su ON su.user_id = gs.staff_id WHERE gs.ticket_id = %s ORDER BY gs.scanned_at""", (ticket_id,))
        payments_ = s.fetch_all("SELECT * FROM Payments WHERE order_id = %s ORDER BY processed_at", (tk["order_id"],))
    return {"ticket": tk, "transfers": transfers_, "scans": scans_, "payments": payments_}
