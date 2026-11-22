"""
FestPass analytics & reporting API (FastAPI).

Read-only companion to the Express API: dashboard KPIs, per-festival reports, the
payment ledger, gate-scan and transfer audit trails, reconciliation (rule 13), and
CSV exports. Every figure is computed from the base tables / views at query time;
nothing calculated is stored (Part 2 b).

Scope: ORGANIZER sees only festivals they run; AUDITOR (read-only persona) sees all.
"""
import csv
import datetime as dt
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
DateParam = Optional[str]


def _days(first, last):
    """Every calendar day from first to last (inclusive), as ISO strings."""
    out, d = [], first
    while d <= last:
        out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


@router.get("/dashboard")
def dashboard(festival_id: Optional[int] = None,
              date_from: DateParam = Query(default=None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
              date_to: DateParam = Query(default=None, alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
              user=Depends(staff)):
    """
    Dashboard KPIs, computed live from the base tables and views.

    Filters (all optional): festival_id, from, to (YYYY-MM-DD, inclusive). A date range applies to
    when things happened: tickets by issue date, payments by processing date, scans by scan time,
    stall applications by application date. Capacity, remaining tickets and "inside now" are
    current snapshots and ignore the dates.
    """
    if date_from and date_to and date_from > date_to:
        raise HTTPException(400, "'from' must be on or before 'to'")
    f_sql, f_params = scope(user)
    s_sql, s_params = scope(user, "s")
    with db.connection() as conn:
        options = db.fetch_all(conn, f"""
            SELECT f.festival_id, f.name, f.status, f.start_date, f.end_date FROM Festivals f
             WHERE {f_sql} ORDER BY f.start_date DESC""", f_params)
        if festival_id:
            festival_or_403(conn, user, festival_id)
            f_sql += " AND f.festival_id = %s"; f_params = [*f_params, festival_id]
            s_sql += " AND s.festival_id = %s"; s_params = [*s_params, festival_id]

        def between(col):
            """SQL + params limiting a column to the chosen date range."""
            sql, params = "", []
            if date_from:
                sql += f" AND {col} >= %s"; params.append(date_from)
            if date_to:
                sql += f" AND {col} < %s + INTERVAL 1 DAY"; params.append(date_to)
            return sql, params

        # Festival rows (current snapshot) -----------------------------------------
        festivals = db.fetch_all(conn, f"""
            SELECT s.*,
                   (SELECT COALESCE(SUM(a.remaining), 0) FROM v_tier_availability a WHERE a.festival_id = s.festival_id) AS remaining,
                   (SELECT COUNT(*) FROM v_ticket_last_scan ls JOIN Tickets tk ON tk.ticket_id = ls.ticket_id
                      JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = s.festival_id AND ls.direction = 'IN') AS inside_now
              FROM v_festival_stats s WHERE {s_sql} ORDER BY s.start_date""", s_params)

        # Tickets ------------------------------------------------------------------
        d_sql, d_params = between("tk.issued_at")
        tickets = db.fetch_one(conn, f"""
            SELECT COALESCE(SUM(o.status = 'PAID' AND tk.status IN ('VALID','CHECKED_IN')), 0) AS sold,
                   COALESCE(SUM(o.status = 'PAID' AND tk.status = 'CHECKED_IN'), 0) AS checked_in,
                   COALESCE(SUM(tk.status = 'REFUNDED'), 0) AS refunded,
                   COALESCE(SUM(tk.status = 'VOID'), 0) AS void,
                   COALESCE(SUM(o.status = 'PENDING' AND tk.status = 'VALID'), 0) AS on_hold,
                   COALESCE(SUM(CASE WHEN o.status = 'PAID' AND tk.status IN ('VALID','CHECKED_IN') THEN t.price END), 0) AS face_value
              FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
             WHERE {f_sql}{d_sql}""", [*f_params, *d_params])
        capacity = db.fetch_one(conn, f"""
            SELECT COALESCE(SUM(a.quota), 0) AS capacity, COALESCE(SUM(a.remaining), 0) AS remaining
              FROM v_tier_availability a JOIN Festivals f ON f.festival_id = a.festival_id
             WHERE {f_sql}{'' if festival_id else " AND f.status IN ('ON_SALE','LIVE','DRAFT')"}""", f_params)

        # Payments -----------------------------------------------------------------
        p_sql, p_params = between("p.processed_at")
        pay_from = f"""
              FROM Payments p
              LEFT JOIN Orders o ON o.order_id = p.order_id
              LEFT JOIN StallAllocations a ON a.allocation_id = p.allocation_id
              LEFT JOIN Stalls st ON st.stall_id = a.stall_id
              JOIN Festivals f ON f.festival_id = COALESCE(o.festival_id, st.festival_id)
             WHERE {f_sql}{p_sql}"""
        pp = [*f_params, *p_params]
        money = db.fetch_one(conn, f"""
            SELECT COALESCE(SUM(CASE WHEN p.status='CAPTURED' AND p.payment_type='CHARGE' THEN p.amount END),0) AS gross,
                   COALESCE(SUM(CASE WHEN p.status='CAPTURED' AND p.payment_type='REFUND' THEN p.amount END),0) AS refunds,
                   COUNT(CASE WHEN p.status='CAPTURED' AND p.payment_type='REFUND' THEN 1 END) AS refund_count,
                   COALESCE(SUM(CASE WHEN p.status='CAPTURED' AND p.payment_type='CHARGE' AND p.order_id IS NOT NULL THEN p.amount END),0) AS ticket_charges,
                   COALESCE(SUM(CASE WHEN p.status='CAPTURED' AND p.payment_type='REFUND' AND p.order_id IS NOT NULL THEN p.amount END),0) AS ticket_refunds,
                   COALESCE(SUM(CASE WHEN p.status='CAPTURED' AND p.payment_type='CHARGE' AND p.allocation_id IS NOT NULL THEN p.amount END),0) AS stall_charges,
                   COALESCE(SUM(CASE WHEN p.status='CAPTURED' AND p.payment_type='REFUND' AND p.allocation_id IS NOT NULL THEN p.amount END),0) AS stall_refunds,
                   COUNT(CASE WHEN p.status='FAILED' THEN 1 END) AS failed_count,
                   COALESCE(SUM(CASE WHEN p.status='FAILED' THEN p.amount END),0) AS failed_amount
            {pay_from}""", pp)
        payment_summary = db.fetch_all(conn, f"""
            SELECT IF(p.order_id IS NULL, 'STALL_FEE', 'TICKET_ORDER') AS context, p.payment_type, p.status,
                   COUNT(*) AS n, SUM(p.amount) AS amount
            {pay_from}
             GROUP BY context, p.payment_type, p.status ORDER BY context DESC, p.payment_type, p.status""", pp)
        methods = db.fetch_all(conn, f"""
            SELECT p.method, COUNT(*) AS n, SUM(p.amount) AS amount
            {pay_from} AND p.status = 'CAPTURED' AND p.payment_type = 'CHARGE' AND p.order_id IS NOT NULL
             GROUP BY p.method ORDER BY amount DESC""", pp)

        # Sales over time ----------------------------------------------------------
        sales = db.fetch_all(conn, f"""
            SELECT DATE(tk.issued_at) AS day, COUNT(*) AS tickets
              FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
             WHERE o.status = 'PAID' AND tk.status IN ('VALID','CHECKED_IN') AND {f_sql}{d_sql}
             GROUP BY DATE(tk.issued_at)""", [*f_params, *d_params])
        cash = db.fetch_all(conn, f"""
            SELECT DATE(p.processed_at) AS day,
                   SUM(CASE WHEN p.payment_type='CHARGE' THEN p.amount ELSE 0 END) AS revenue,
                   SUM(CASE WHEN p.payment_type='REFUND' THEN p.amount ELSE 0 END) AS refunds,
                   COUNT(DISTINCT CASE WHEN p.payment_type='CHARGE' THEN p.order_id END) AS orders
            {pay_from} AND p.status = 'CAPTURED' AND p.order_id IS NOT NULL
             GROUP BY DATE(p.processed_at)""", pp)

        # Gate entries -------------------------------------------------------------
        g_sql, g_params = between("gs.scanned_at")
        scan_from = f"""
              FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
             WHERE {f_sql}{g_sql}"""
        gp = [*f_params, *g_params]
        gate = db.fetch_one(conn, f"""
            SELECT COUNT(*) AS scans,
                   COALESCE(SUM(gs.direction='IN' AND gs.result='ACCEPTED'), 0) AS entries,
                   COALESCE(SUM(gs.direction='OUT' AND gs.result='ACCEPTED'), 0) AS exits,
                   COALESCE(SUM(gs.result<>'ACCEPTED'), 0) AS rejected,
                   COUNT(DISTINCT CASE WHEN gs.direction='IN' AND gs.result='ACCEPTED' THEN gs.ticket_id END) AS unique_visitors
            {scan_from}""", gp)
        gate_results = db.fetch_all(conn, f"SELECT gs.result, COUNT(*) AS n {scan_from} GROUP BY gs.result ORDER BY n DESC", gp)
        gate_by_gate = db.fetch_all(conn, f"""
            SELECT gs.gate_code, SUM(gs.direction='IN' AND gs.result='ACCEPTED') AS entries,
                   SUM(gs.direction='OUT' AND gs.result='ACCEPTED') AS exits, SUM(gs.result<>'ACCEPTED') AS rejected
            {scan_from} GROUP BY gs.gate_code ORDER BY entries DESC""", gp)
        gate_daily = db.fetch_all(conn, f"""
            SELECT DATE(gs.scanned_at) AS day, SUM(gs.direction='IN' AND gs.result='ACCEPTED') AS entries,
                   SUM(gs.direction='OUT' AND gs.result='ACCEPTED') AS exits, SUM(gs.result<>'ACCEPTED') AS rejected
            {scan_from} GROUP BY DATE(gs.scanned_at) ORDER BY day""", gp)

        # Vendor applications ------------------------------------------------------
        a_sql, a_params = between("a.applied_at")
        alloc_from = f"""
              FROM StallAllocations a JOIN v_allocation_balance b ON b.allocation_id = a.allocation_id
              JOIN Stalls st ON st.stall_id = a.stall_id JOIN Festivals f ON f.festival_id = st.festival_id
             WHERE {f_sql}{a_sql}"""
        ap = [*f_params, *a_params]
        applications = db.fetch_all(conn, f"SELECT a.status, COUNT(*) AS n {alloc_from} GROUP BY a.status", ap)
        fees = db.fetch_one(conn, f"""
            SELECT COALESCE(SUM(CASE WHEN a.status='APPROVED' THEN a.agreed_fee END), 0) AS contracted,
                   COALESCE(SUM(CASE WHEN a.status='APPROVED' THEN LEAST(b.paid_amount, a.agreed_fee) END), 0) AS paid,
                   COALESCE(SUM(CASE WHEN a.status='APPROVED' THEN GREATEST(a.agreed_fee - b.paid_amount, 0) END), 0) AS outstanding,
                   COUNT(DISTINCT CASE WHEN a.status='APPROVED' THEN a.vendor_id END) AS vendors_on_site
            {alloc_from}""", ap)
        stalls = db.fetch_one(conn, f"""
            SELECT COUNT(*) AS stalls, COALESCE(SUM(s.stalls_allocated), 0) AS allocated FROM (
              SELECT st.stall_id, (SELECT COUNT(*) FROM StallAllocations x WHERE x.stall_id = st.stall_id AND x.status = 'APPROVED') AS stalls_allocated
                FROM Stalls st JOIN Festivals f ON f.festival_id = st.festival_id WHERE {f_sql}) s""", f_params)
        vendor_status = db.fetch_all(conn, "SELECT status, COUNT(*) AS n FROM Vendors GROUP BY status")

        # Small extras kept from the original dashboard ------------------------------
        pending_apps = db.fetch_one(conn, f"""
            SELECT COUNT(*) AS n FROM StallAllocations a JOIN Stalls st ON st.stall_id = a.stall_id
              JOIN Festivals f ON f.festival_id = st.festival_id WHERE a.status = 'APPLIED' AND {f_sql}""", f_params)
        pending_vendors = db.fetch_one(conn, "SELECT COUNT(*) AS n FROM Vendors WHERE status = 'PENDING_REVIEW'")
        t_sql, t_params = between("tt.transferred_at")
        transfers = db.fetch_one(conn, f"""
            SELECT COUNT(*) AS n FROM TicketTransfers tt JOIN Tickets tk ON tk.ticket_id = tt.ticket_id
              JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
             WHERE {f_sql}{t_sql}""", [*f_params, *t_params])
        o_sql, o_params = between("o.created_at")
        recent = db.fetch_all(conn, f"""
            SELECT o.order_id, o.status, o.created_at, u.full_name AS buyer_name, f.name AS festival_name,
                   ot.ticket_count, ot.total_amount
              FROM Orders o JOIN v_order_totals ot ON ot.order_id = o.order_id
              JOIN Users u ON u.user_id = o.buyer_id JOIN Festivals f ON f.festival_id = o.festival_id
             WHERE {f_sql}{o_sql} ORDER BY o.created_at DESC, o.order_id DESC LIMIT 8""", [*f_params, *o_params])

    # One row per calendar day so charts show quiet days as zero ----------------------
    by_day = {}
    for r in sales:
        by_day.setdefault(str(r["day"]), {})["tickets"] = int(r["tickets"])
    for r in cash:
        by_day.setdefault(str(r["day"]), {}).update(revenue=float(r["revenue"]), refunds=float(r["refunds"]), orders=int(r["orders"]))
    series = []
    if by_day or (date_from and date_to):
        first = dt.date.fromisoformat(date_from) if date_from else dt.date.fromisoformat(min(by_day))
        last = dt.date.fromisoformat(date_to) if date_to else max(dt.date.today(), dt.date.fromisoformat(max(by_day)))
        if (last - first).days > 731:  # keep the chart readable: at most two years of days
            first = last - dt.timedelta(days=731)
        running = 0
        for day in _days(first, last):
            r = by_day.get(day, {})
            running += r.get("tickets", 0)
            series.append({"day": day, "tickets": r.get("tickets", 0), "cumulative_tickets": running,
                           "revenue": r.get("revenue", 0.0), "refunds": r.get("refunds", 0.0), "orders": r.get("orders", 0)})

    ints = lambda rows: [{k: (int(v) if isinstance(v, float) and k not in ("amount",) else v) for k, v in r.items()} for r in rows]  # noqa: E731
    gate_by_gate, gate_daily = ints(gate_by_gate), ints(gate_daily)
    stalls = {k: int(v) for k, v in stalls.items()}
    fees = {k: (int(v) if k == "vendors_on_site" else float(v)) for k, v in fees.items()}
    gross, refunds = float(money["gross"]), float(money["refunds"])
    status_count = {r["status"]: int(r["n"]) for r in applications}
    total = lambda k: sum(float(f[k] or 0) for f in festivals)  # noqa: E731
    return {
        "filters": {"festival_id": festival_id, "from": date_from, "to": date_to, "festivals": options},
        "totals": {
            "festivals": len(festivals),
            "live": sum(1 for f in festivals if f["status"] == "LIVE"),
            "on_sale": sum(1 for f in festivals if f["status"] == "ON_SALE"),
            "tickets_sold": int(tickets["sold"]),
            "checked_in": int(tickets["checked_in"]),
            "ticket_revenue": float(money["ticket_charges"]) - float(money["ticket_refunds"]),
            "stall_revenue": float(money["stall_charges"]) - float(money["stall_refunds"]),
            "gross": gross, "refunds": refunds, "refund_count": int(money["refund_count"]),
            "net": gross - refunds,
            "pending_applications": pending_apps["n"],
            "pending_vendors": pending_vendors["n"],
            "transfers": transfers["n"],
        },
        "tickets": {
            "sold": int(tickets["sold"]), "checked_in": int(tickets["checked_in"]),
            "refunded": int(tickets["refunded"]), "void": int(tickets["void"]), "on_hold": int(tickets["on_hold"]),
            "face_value": float(tickets["face_value"]),
            "capacity": int(capacity["capacity"]), "remaining": int(capacity["remaining"]),
        },
        "attendance": {
            "sold": int(total("tickets_sold")), "checked_in": int(total("checked_in")),
            "inside_now": int(total("inside_now")),
        },
        "revenue": {k: float(v) for k, v in money.items() if k not in ("refund_count", "failed_count")}
        | {"refund_count": int(money["refund_count"]), "failed_count": int(money["failed_count"]), "net": gross - refunds},
        "payments": payment_summary,
        "gate": {k: int(v) for k, v in gate.items()} | {"by_result": gate_results, "by_gate": gate_by_gate, "daily": gate_daily},
        "vendors": {
            "applications": {s: status_count.get(s, 0) for s in ("APPLIED", "APPROVED", "REJECTED", "CANCELLED")},
            "total_applications": sum(status_count.values()),
            "fees": fees, "stalls": stalls,
            "registry": {r["status"]: int(r["n"]) for r in vendor_status},
        },
        "sales": series,
        "festivals": festivals,
        "daily": series,
        "methods": methods,
        "recent_orders": recent,
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
