"""
FestPass analytics & reporting API (FastAPI).

Read-only companion to the Express API: dashboard KPIs, per-festival reports, the
payment ledger, gate-scan and transfer audit trails, reconciliation (rule 13), and
CSV exports. Every figure is computed from the base tables / views at query time;
nothing calculated is stored (Part 2 b).

Scope: ORGANIZER sees only festivals they run; AUDITOR (read-only persona) sees all.
"""
import csv
import io
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from . import db
from .auth import staff

router = APIRouter(prefix="/analytics", tags=["analytics"])

Fmt = Optional[Literal["json", "csv"]]


def scope(user, alias="f"):
    if user["role"] == "AUDITOR":
        return "1=1", []
    return f"{alias}.organizer_id = %s", [user["user_id"]]


def festival_or_403(conn, user, festival_id):
    f = db.fetch_one(conn, "SELECT * FROM Festivals WHERE festival_id = %s", (festival_id,))
    if not f:
        raise HTTPException(404, "Festival not found")
    if user["role"] == "ORGANIZER" and f["organizer_id"] != user["user_id"]:
        raise HTTPException(403, "You do not have permission to do this")
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
def dashboard(user=Depends(staff)):
    s_sql, s_params = scope(user, "s")
    f_sql, f_params = scope(user)
    with db.connection() as conn:
        festivals = db.fetch_all(conn, f"SELECT * FROM v_festival_stats s WHERE {s_sql} ORDER BY s.start_date", s_params)
        money = db.fetch_one(conn, f"""
            SELECT COALESCE(SUM(CASE WHEN p.payment_type='CHARGE' THEN p.amount END),0) AS gross,
                   COALESCE(SUM(CASE WHEN p.payment_type='REFUND' THEN p.amount END),0) AS refunds,
                   COUNT(CASE WHEN p.payment_type='REFUND' THEN 1 END) AS refund_count
              FROM Payments p
              LEFT JOIN Orders o ON o.order_id = p.order_id
              LEFT JOIN StallAllocations a ON a.allocation_id = p.allocation_id
              LEFT JOIN Stalls st ON st.stall_id = a.stall_id
              JOIN Festivals f ON f.festival_id = COALESCE(o.festival_id, st.festival_id)
             WHERE p.status = 'CAPTURED' AND {f_sql}""", f_params)
        daily = db.fetch_all(conn, f"""
            SELECT DATE(p.processed_at) AS day,
                   SUM(CASE WHEN p.payment_type='CHARGE' THEN p.amount ELSE 0 END) AS revenue,
                   SUM(CASE WHEN p.payment_type='REFUND' THEN p.amount ELSE 0 END) AS refunds,
                   COUNT(DISTINCT CASE WHEN p.payment_type='CHARGE' THEN p.order_id END) AS orders
              FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
             WHERE p.status = 'CAPTURED' AND p.processed_at >= CURDATE() - INTERVAL 29 DAY AND {f_sql}
             GROUP BY DATE(p.processed_at) ORDER BY day""", f_params)
        methods = db.fetch_all(conn, f"""
            SELECT p.method, COUNT(*) AS n, SUM(p.amount) AS amount
              FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
             WHERE p.status = 'CAPTURED' AND p.payment_type = 'CHARGE' AND {f_sql} GROUP BY p.method""", f_params)
        pending_apps = db.fetch_one(conn, f"""
            SELECT COUNT(*) AS n FROM StallAllocations a JOIN Stalls st ON st.stall_id = a.stall_id
              JOIN Festivals f ON f.festival_id = st.festival_id WHERE a.status = 'APPLIED' AND {f_sql}""", f_params)
        pending_vendors = db.fetch_one(conn, "SELECT COUNT(*) AS n FROM Vendors WHERE status = 'PENDING_REVIEW'")
        transfers = db.fetch_one(conn, f"""
            SELECT COUNT(*) AS n FROM TicketTransfers tt JOIN Tickets tk ON tk.ticket_id = tt.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
             WHERE {f_sql}""", f_params)
        recent = db.fetch_all(conn, f"""
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
def festival_report(festival_id: int, user=Depends(staff)):
    with db.connection() as conn:
        festival_or_403(conn, user, festival_id)
        p = (festival_id,)
        stats = db.fetch_one(conn, "SELECT * FROM v_festival_stats WHERE festival_id = %s", p)
        tiers = db.fetch_all(conn, """
            SELECT a.*, COALESCE(r.revenue, 0) AS revenue FROM v_tier_availability a
              LEFT JOIN (SELECT tk.tier_id, SUM(t.price) AS revenue FROM Tickets tk
                           JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Orders o ON o.order_id = tk.order_id
                          WHERE o.status = 'PAID' AND tk.status IN ('VALID','CHECKED_IN') GROUP BY tk.tier_id) r
                ON r.tier_id = a.tier_id
             WHERE a.festival_id = %s ORDER BY a.price""", p)
        daily = db.fetch_all(conn, """
            SELECT DATE(o.paid_at) AS day, COUNT(tk.ticket_id) AS tickets, SUM(t.price) AS revenue
              FROM Orders o JOIN Tickets tk ON tk.order_id = o.order_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE o.festival_id = %s AND o.paid_at IS NOT NULL GROUP BY DATE(o.paid_at) ORDER BY day""", p)
        gates = db.fetch_all(conn, """
            SELECT gs.gate_code,
                   SUM(gs.direction='IN' AND gs.result='ACCEPTED') AS entries,
                   SUM(gs.direction='OUT' AND gs.result='ACCEPTED') AS exits,
                   SUM(gs.result<>'ACCEPTED') AS rejected
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE t.festival_id = %s GROUP BY gs.gate_code ORDER BY gs.gate_code""", p)
        rejections = db.fetch_all(conn, """
            SELECT gs.result, COUNT(*) AS n
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE t.festival_id = %s GROUP BY gs.result""", p)
        hourly = db.fetch_all(conn, """
            SELECT DATE_FORMAT(gs.scanned_at, '%%Y-%%m-%%d %%H:00') AS hour,
                   SUM(gs.direction='IN' AND gs.result='ACCEPTED') AS entries,
                   SUM(gs.direction='OUT' AND gs.result='ACCEPTED') AS exits,
                   SUM(gs.result<>'ACCEPTED') AS rejected
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
             WHERE t.festival_id = %s GROUP BY hour ORDER BY hour""", p)
        inside = db.fetch_one(conn, """
            SELECT COUNT(*) AS n FROM v_ticket_last_scan ls JOIN Tickets tk ON tk.ticket_id = ls.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = %s AND ls.direction = 'IN'""", p)
        orders = db.fetch_one(conn, """
            SELECT COUNT(*) AS total, COALESCE(SUM(status='PAID'),0) AS paid, COALESCE(SUM(status='PENDING'),0) AS pending,
                   COALESCE(SUM(status='EXPIRED'),0) AS expired, COALESCE(SUM(status='CANCELLED'),0) AS cancelled,
                   COALESCE(SUM(status='REFUNDED'),0) AS refunded
              FROM Orders WHERE festival_id = %s""", p)
        refunds = db.fetch_one(conn, """
            SELECT COUNT(*) AS n, COALESCE(SUM(p.amount),0) AS amount FROM Payments p JOIN Orders o ON o.order_id = p.order_id
             WHERE o.festival_id = %s AND p.payment_type = 'REFUND' AND p.status = 'CAPTURED'""", p)
        stalls = db.fetch_all(conn, """
            SELECT s.zone, COUNT(*) AS stalls, SUM(a.allocation_id IS NOT NULL) AS allocated,
                   COALESCE(SUM(a.agreed_fee), 0) AS contracted_fees
              FROM Stalls s LEFT JOIN StallAllocations a ON a.stall_id = s.stall_id AND a.status = 'APPROVED'
             WHERE s.festival_id = %s GROUP BY s.zone""", p)
    return {"stats": stats, "tiers": tiers, "daily": daily, "gates": gates, "rejections": rejections,
            "hourly": hourly, "inside_now": inside["n"], "orders": orders, "refunds": refunds, "stalls": stalls}


@router.get("/festivals/{festival_id}/attendees")
def attendees(festival_id: int, q: Optional[str] = None,
              status: Optional[Literal["VALID", "CHECKED_IN", "REFUNDED", "VOID"]] = None,
              format: Fmt = None, user=Depends(staff)):
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
    with db.connection() as conn:
        festival_or_403(conn, user, festival_id)
        rows = db.fetch_all(conn, sql, params)
    return maybe_csv(rows, format, f"attendees-festival-{festival_id}", "attendees")


# ------------------------------------------------------------ ledgers/audit
@router.get("/payments")
def payments(festival_id: Optional[int] = None,
             type: Optional[Literal["CHARGE", "REFUND"]] = None,
             status: Optional[Literal["AUTHORIZED", "CAPTURED", "FAILED"]] = None,
             context: Optional[Literal["TICKET_ORDER", "STALL_FEE"]] = None,
             date_from: Optional[str] = Query(default=None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
             date_to: Optional[str] = Query(default=None, alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
             format: Fmt = None, user=Depends(staff)):
    f_sql, params = scope(user)
    where = [f_sql]
    if festival_id:
        where.append("f.festival_id = %s"); params.append(festival_id)
    if type:
        where.append("p.payment_type = %s"); params.append(type)
    if status:
        where.append("p.status = %s"); params.append(status)
    if context == "TICKET_ORDER":
        where.append("p.order_id IS NOT NULL")
    if context == "STALL_FEE":
        where.append("p.allocation_id IS NOT NULL")
    if date_from:
        where.append("p.processed_at >= %s"); params.append(date_from)
    if date_to:
        where.append("p.processed_at < %s + INTERVAL 1 DAY"); params.append(date_to)
    with db.connection() as conn:
        rows = db.fetch_all(conn, f"""
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
             WHERE {' AND '.join(where)}
             ORDER BY p.processed_at DESC, p.payment_id DESC LIMIT 1000""", params)
    return maybe_csv(rows, format, "payments", "payments")


@router.get("/reconciliation")
def reconciliation(show: Optional[Literal["all"]] = None, user=Depends(staff)):
    """Rule 13 check: compares each order's tickets with its CHARGE/REFUND rows."""
    f_sql, params = scope(user)
    with db.connection() as conn:
        rows = db.fetch_all(conn, f"""
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
        summary = db.fetch_one(conn, f"""
            SELECT COUNT(*) AS orders, COALESCE(SUM(ot.captured_amount),0) AS captured,
                   COALESCE(SUM(ot.refunded_amount),0) AS refunded,
                   COALESCE(SUM(ot.status='PAID'),0) AS paid_orders
              FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id WHERE {f_sql}""", params)
        stall = db.fetch_one(conn, f"""
            SELECT COALESCE(SUM(b.paid_amount),0) AS fees_captured, COALESCE(SUM(b.refunded_amount),0) AS fees_refunded,
                   COALESCE(SUM(a.status='APPROVED' AND b.paid_amount < a.agreed_fee),0) AS fees_outstanding
              FROM v_allocation_balance b JOIN StallAllocations a ON a.allocation_id = b.allocation_id
              JOIN Stalls s ON s.stall_id = a.stall_id JOIN Festivals f ON f.festival_id = s.festival_id
             WHERE {f_sql}""", params)
    return {"issues": rows, "summary": {**summary, **stall}}


@router.get("/transfers")
def transfers(format: Fmt = None, user=Depends(staff)):
    f_sql, params = scope(user)
    with db.connection() as conn:
        rows = db.fetch_all(conn, f"""
            SELECT tt.transfer_id, tt.transferred_at, tt.ticket_id, t.tier_name, f.name AS festival_name,
                   fu.full_name AS from_name, fu.email AS from_email, tu.full_name AS to_name, tu.email AS to_email
              FROM TicketTransfers tt JOIN Tickets tk ON tk.ticket_id = tt.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
              JOIN Users fu ON fu.user_id = tt.from_user_id JOIN Users tu ON tu.user_id = tt.to_user_id
             WHERE {f_sql} ORDER BY tt.transferred_at DESC LIMIT 1000""", params)
    return maybe_csv(rows, format, "transfers", "transfers")


@router.get("/scans")
def scans(festival_id: Optional[int] = None,
          result: Optional[Literal["ACCEPTED", "REJECTED_DUPLICATE", "REJECTED_INVALID", "REJECTED_NOT_LIVE"]] = None,
          ticket_id: Optional[str] = Query(default=None, pattern=r"^[0-9a-fA-F-]{36}$"),
          format: Fmt = None, user=Depends(staff)):
    f_sql, params = scope(user)
    where = [f_sql]
    if festival_id:
        where.append("f.festival_id = %s"); params.append(festival_id)
    if result:
        where.append("gs.result = %s"); params.append(result)
    if ticket_id:
        where.append("gs.ticket_id = %s"); params.append(ticket_id)
    with db.connection() as conn:
        rows = db.fetch_all(conn, f"""
            SELECT gs.scan_id, gs.scanned_at, gs.gate_code, gs.direction, gs.result, gs.ticket_id,
                   hu.full_name AS holder_name, su.full_name AS staff_name, t.tier_name, f.name AS festival_name
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
              JOIN Festivals f ON f.festival_id = t.festival_id JOIN Users hu ON hu.user_id = tk.holder_id
              JOIN Users su ON su.user_id = gs.staff_id
             WHERE {' AND '.join(where)} ORDER BY gs.scanned_at DESC LIMIT 1000""", params)
    return maybe_csv(rows, format, "gate-scans", "scans")


@router.get("/tickets/{ticket_id}/trail")
def ticket_trail(ticket_id: str, user=Depends(staff)):
    """Who bought it, who received it, where and when it was scanned (problem: no audit trail)."""
    with db.connection() as conn:
        tk = db.fetch_one(conn, """
            SELECT tk.ticket_id, tk.status, tk.issued_at, t.tier_name, t.price, f.festival_id, f.name AS festival_name,
                   f.organizer_id, o.order_id, o.status AS order_status, o.created_at AS ordered_at, o.paid_at,
                   bu.full_name AS buyer_name, bu.email AS buyer_email, hu.full_name AS holder_name, hu.email AS holder_email
              FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
              JOIN Orders o ON o.order_id = tk.order_id JOIN Users bu ON bu.user_id = o.buyer_id
              JOIN Users hu ON hu.user_id = tk.holder_id
             WHERE tk.ticket_id = %s""", (ticket_id,))
        if not tk:
            raise HTTPException(404, "Ticket not found")
        if user["role"] == "ORGANIZER" and tk["organizer_id"] != user["user_id"]:
            raise HTTPException(403, "You do not have permission to do this")
        transfers_ = db.fetch_all(conn, """
            SELECT tt.transferred_at, fu.full_name AS from_name, tu.full_name AS to_name FROM TicketTransfers tt
              JOIN Users fu ON fu.user_id = tt.from_user_id JOIN Users tu ON tu.user_id = tt.to_user_id
             WHERE tt.ticket_id = %s""", (ticket_id,))
        scans_ = db.fetch_all(conn, """
            SELECT gs.scanned_at, gs.gate_code, gs.direction, gs.result, su.full_name AS staff_name FROM GateScans gs
              JOIN Users su ON su.user_id = gs.staff_id WHERE gs.ticket_id = %s ORDER BY gs.scanned_at""", (ticket_id,))
        payments_ = db.fetch_all(conn, "SELECT * FROM Payments WHERE order_id = %s ORDER BY processed_at", (tk["order_id"],))
    return {"ticket": tk, "transfers": transfers_, "scans": scans_, "payments": payments_}
