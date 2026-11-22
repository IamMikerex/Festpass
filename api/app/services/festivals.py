"""Festival lifecycle (rule 12) and cancellation with full refunds (rule 7)."""
import datetime as dt

from ..db import db, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
from . import gateway

NEXT = {
    "DRAFT": ["ON_SALE", "CANCELLED"],
    "ON_SALE": ["LIVE", "CANCELLED"],
    "LIVE": ["COMPLETED", "CANCELLED"],
    "COMPLETED": [],
    "CANCELLED": [],
}


def load_owned(s, user, festival_id, lock=False):
    f = s.fetch_one(f"SELECT * FROM Festivals WHERE festival_id = %s{' FOR UPDATE' if lock else ''}", (festival_id,))
    if not f:
        raise NotFound("Festival not found")
    if user["role"] != "ORGANIZER" or f["organizer_id"] != user["user_id"]:
        raise Forbidden("Only this festival's organizer can do that")
    return f


def first_charge_method(s, column, owner_id, fallback):
    method = s.scalar(
        f"SELECT method FROM Payments WHERE {column} = %s AND payment_type = 'CHARGE' AND status = 'CAPTURED' "
        "ORDER BY payment_id LIMIT 1", (owner_id,))
    return method or fallback


def cancel_festival(tx, festival):
    """Refunds every live ticket at 100 % (one REFUND per order), voids checkouts, annuls stalls with full refunds."""
    fid = festival["festival_id"]
    summary = dict(orders_refunded=0, tickets_refunded=0, amount_refunded=0.0,
                   pending_cancelled=0, allocations_cancelled=0, fees_refunded=0.0)

    for o in tx.fetch_all("SELECT order_id FROM Orders WHERE festival_id = %s AND status = 'PENDING' FOR UPDATE", (fid,)):
        tx.execute("UPDATE Tickets SET status = 'VOID' WHERE order_id = %s AND status = 'VALID'", (o["order_id"],))
        tx.execute("UPDATE Orders SET status = 'CANCELLED' WHERE order_id = %s", (o["order_id"],))
        summary["pending_cancelled"] += 1

    for o in tx.fetch_all("SELECT order_id FROM Orders WHERE festival_id = %s AND status = 'PAID' FOR UPDATE", (fid,)):
        oid = o["order_id"]
        live = tx.fetch_one(
            """SELECT COUNT(*) AS n, COALESCE(SUM(ti.price), 0) AS value
                 FROM Tickets tk JOIN TicketTiers ti ON ti.tier_id = tk.tier_id
                WHERE tk.order_id = %s AND tk.status IN ('VALID','CHECKED_IN')""", (oid,))
        bal = tx.fetch_one("SELECT captured_amount, refunded_amount FROM v_order_totals WHERE order_id = %s", (oid,))
        refundable = round(min(live["value"], bal["captured_amount"] - bal["refunded_amount"]), 2)
        if refundable > 0:
            tx.execute(
                "INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref) "
                "VALUES (%s, 'REFUND', %s, %s, 'CAPTURED', %s)",
                (oid, refundable, first_charge_method(tx, "order_id", oid, "CARD"), gateway.refund_reference()))
            summary["amount_refunded"] += refundable
        tx.execute("UPDATE Tickets SET status = 'REFUNDED' WHERE order_id = %s AND status IN ('VALID','CHECKED_IN')", (oid,))
        tx.execute("UPDATE Orders SET status = 'REFUNDED' WHERE order_id = %s", (oid,))
        summary["orders_refunded"] += 1
        summary["tickets_refunded"] += live["n"]

    allocations = tx.fetch_all(
        """SELECT a.allocation_id, a.status FROM StallAllocations a JOIN Stalls s ON s.stall_id = a.stall_id
            WHERE s.festival_id = %s AND a.status IN ('APPLIED','APPROVED') FOR UPDATE""", (fid,))
    for a in allocations:
        aid = a["allocation_id"]
        if a["status"] == "APPLIED":
            tx.execute("UPDATE StallAllocations SET status = 'REJECTED' WHERE allocation_id = %s", (aid,))
            continue
        bal = tx.fetch_one("SELECT paid_amount, refunded_amount FROM v_allocation_balance WHERE allocation_id = %s", (aid,))
        due = round(bal["paid_amount"] - bal["refunded_amount"], 2)
        if due > 0:
            tx.execute(
                "INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref) "
                "VALUES (%s, 'REFUND', %s, 'BANK_TRANSFER', 'CAPTURED', %s)", (aid, due, gateway.refund_reference()))
            summary["fees_refunded"] += due
        tx.execute("UPDATE StallAllocations SET status = 'CANCELLED' WHERE allocation_id = %s", (aid,))
        summary["allocations_cancelled"] += 1
    return summary


def change_status(user, festival_id, status):
    with transaction() as tx:
        f = load_owned(tx, user, festival_id, lock=True)
        allowed = NEXT[f["status"]]
        if status not in allowed:
            raise Conflict(f"A {f['status']} festival can move to: {', '.join(allowed) or 'nothing (final state)'} (rule 12)")
        if status == "ON_SALE" and not tx.scalar("SELECT COUNT(*) FROM TicketTiers WHERE festival_id = %s", (festival_id,)):
            raise Conflict("Add at least one ticket tier before opening sales")
        tx.execute("UPDATE Festivals SET status = %s WHERE festival_id = %s", (status, festival_id))
        summary = cancel_festival(tx, f) if status == "CANCELLED" else None
    return {"status": status, "summary": summary}


def advance_lifecycle():
    """Scheduled: ON_SALE -> LIVE on the start date, LIVE -> COMPLETED after the end date."""
    return (db.execute("UPDATE Festivals SET status = 'LIVE' "
                       "WHERE status = 'ON_SALE' AND start_date <= CURDATE() AND end_date >= CURDATE()")
            + db.execute("UPDATE Festivals SET status = 'COMPLETED' WHERE status = 'LIVE' AND end_date < CURDATE()"))


def assert_editable(f, body):
    if f["status"] in ("COMPLETED", "CANCELLED"):
        raise Conflict(f"A {f['status']} festival can no longer be edited")
    locked_changed = (str(body.start_date) != f["start_date"] or str(body.end_date) != f["end_date"]
                      or body.min_age != f["min_age"])
    if f["status"] != "DRAFT" and locked_changed and db.scalar(
            "SELECT COUNT(*) FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = %s",
            (f["festival_id"],)):
        raise Conflict("Dates and age limit are locked once tickets have been sold")


def assert_tier_window(tier, festival):
    if tier.sale_end > dt.datetime.fromisoformat(f"{festival['end_date']}T23:59:59"):
        raise BadRequest("Ticket sales must end before the festival ends")
