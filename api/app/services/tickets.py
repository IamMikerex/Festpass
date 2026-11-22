"""Ticket wallet, one controlled transfer (rule 5) and date-based refunds (rule 6)."""
from ..db import db, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
from . import gateway
from .festivals import first_charge_method

TICKET_SELECT = """
    SELECT tk.ticket_id, tk.order_id, tk.tier_id, tk.holder_id, tk.status, tk.issued_at,
           t.tier_name, t.price, f.festival_id, f.name AS festival_name, f.venue_name, f.city,
           f.start_date, f.end_date, f.status AS festival_status, f.organizer_id,
           o.status AS order_status, o.buyer_id,
           hu.full_name AS holder_name, hu.email AS holder_email, bu.full_name AS buyer_name,
           (SELECT COUNT(*) FROM TicketTransfers tt WHERE tt.ticket_id = tk.ticket_id) AS transfer_count,
           (NOW() <= TIMESTAMP(f.start_date) - INTERVAL 48 HOUR) AS transfer_window_open,
           q.days_before_start, q.refund_rate, q.refund_amount, q.refundable,
           ls.direction AS last_scan_direction, ls.scanned_at AS last_scan_at, ls.gate_code AS last_scan_gate
      FROM Tickets tk
      JOIN TicketTiers t ON t.tier_id = tk.tier_id
      JOIN Festivals f   ON f.festival_id = t.festival_id
      JOIN Orders o      ON o.order_id = tk.order_id
      JOIN Users hu      ON hu.user_id = tk.holder_id
      JOIN Users bu      ON bu.user_id = o.buyer_id
      JOIN v_ticket_refund_quote q ON q.ticket_id = tk.ticket_id
      LEFT JOIN v_ticket_last_scan ls ON ls.ticket_id = tk.ticket_id"""


def _refund_block(tk, uid, transferred):
    if tk["status"] == "CHECKED_IN":
        return "Checked-in tickets cannot be refunded (rule 6)"
    if tk["status"] != "VALID":
        return f"Ticket is {tk['status']}"
    if transferred:
        return "Transferred tickets cannot be refunded"
    if tk["buyer_id"] != uid:
        return "Only the buyer can request a refund"
    if tk["days_before_start"] < 7:
        return "Less than 7 days before the festival: no refund (rule 6)"
    return None


def _transfer_block(tk, transferred):
    if transferred:
        return "This ticket has already been transferred once (rule 5)"
    if tk["status"] != "VALID":
        return f"Ticket is {tk['status']}"
    if not tk["transfer_window_open"]:
        return "Transfers close 48 hours before the festival (rule 5)"
    return None


def decorate(tk, user):
    """Adds what the signed-in user may do with the ticket, and why not."""
    uid, transferred = user["user_id"], tk["transfer_count"] > 0
    tk["can_transfer"] = (tk["holder_id"] == uid and tk["status"] == "VALID" and tk["order_status"] == "PAID"
                          and not transferred and bool(tk["transfer_window_open"])
                          and tk["festival_status"] in ("ON_SALE", "LIVE"))
    tk["can_refund"] = (tk["buyer_id"] == uid and bool(tk["refundable"]) and not transferred
                        and tk["festival_status"] != "CANCELLED")
    tk["refund_block_reason"] = None if tk["can_refund"] else _refund_block(tk, uid, transferred)
    tk["transfer_block_reason"] = None if tk["can_transfer"] else _transfer_block(tk, transferred)
    return tk


def list_mine(user):
    rows = db.fetch_all(f"{TICKET_SELECT} WHERE tk.holder_id = %s AND o.status IN ('PAID','REFUNDED','CANCELLED') "
                        "ORDER BY f.start_date, t.tier_name", (user["user_id"],))
    return [decorate(r, user) for r in rows]


def get_ticket(user, ticket_id, include_qr=False):
    tk = db.fetch_one(f"{TICKET_SELECT} WHERE tk.ticket_id = %s", (ticket_id,))
    if not tk:
        raise NotFound("Ticket not found")
    own = user["user_id"] in (tk["holder_id"], tk["buyer_id"])
    staff = user["role"] == "AUDITOR" or (user["role"] == "ORGANIZER" and tk["organizer_id"] == user["user_id"])
    if not own and not staff:
        raise Forbidden("You do not have permission to do this")
    decorate(tk, user)
    # The QR token is the admission secret: only the current holder of a paid, usable ticket sees it.
    if (include_qr and tk["holder_id"] == user["user_id"] and tk["order_status"] == "PAID"
            and tk["status"] in ("VALID", "CHECKED_IN")):
        tk["qr_token"] = db.scalar("SELECT qr_token FROM Tickets WHERE ticket_id = %s", (ticket_id,))
    return tk


def history(user, ticket_id):
    get_ticket(user, ticket_id)
    return {
        "transfers": db.fetch_all(
            """SELECT tt.transferred_at, fu.full_name AS from_name, tu.full_name AS to_name
                 FROM TicketTransfers tt JOIN Users fu ON fu.user_id = tt.from_user_id
                 JOIN Users tu ON tu.user_id = tt.to_user_id WHERE tt.ticket_id = %s""", (ticket_id,)),
        "scans": db.fetch_all(
            """SELECT gs.scanned_at, gs.gate_code, gs.direction, gs.result, u.full_name AS staff_name
                 FROM GateScans gs JOIN Users u ON u.user_id = gs.staff_id
                WHERE gs.ticket_id = %s ORDER BY gs.scanned_at DESC""", (ticket_id,)),
    }


def transfer(user, ticket_id, email):
    """Locks the ticket row so a concurrent refund cannot interleave; the new holder gets a fresh QR."""
    with transaction() as tx:
        tk = tx.fetch_one(
            """SELECT tk.*, f.start_date, f.min_age, (NOW() <= TIMESTAMP(f.start_date) - INTERVAL 48 HOUR) AS window_open
                 FROM Tickets tk JOIN TicketTiers ti ON ti.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = ti.festival_id
                WHERE tk.ticket_id = %s FOR UPDATE""", (ticket_id,))
        if not tk:
            raise NotFound("Ticket not found")
        if tk["holder_id"] != user["user_id"]:
            raise Forbidden("Only the current holder can transfer this ticket")
        if tk["status"] != "VALID":
            raise Conflict(f"Only VALID tickets can be transferred; this one is {tk['status']} (rule 5)")
        if not tk["window_open"]:
            raise Conflict("Transfers close 48 hours before the festival starts (rule 5)")
        if tx.scalar("SELECT COUNT(*) FROM TicketTransfers WHERE ticket_id = %s", (ticket_id,)):
            raise Conflict("This ticket has already been transferred once (rule 5)")

        to = tx.fetch_one("SELECT user_id, full_name, account_status, TIMESTAMPDIFF(YEAR, date_of_birth, %s) AS age "
                          "FROM Users WHERE email = %s", (tk["start_date"], email))
        if not to or to["account_status"] != "ACTIVE":
            raise BadRequest("The recipient must have an active FestPass account")
        if to["user_id"] == user["user_id"]:
            raise BadRequest("You cannot transfer a ticket to yourself")
        if to["age"] < tk["min_age"]:
            raise Conflict(f"{to['full_name']} is under the festival minimum age of {tk['min_age']} (rule 4)")

        tx.execute("INSERT INTO TicketTransfers (ticket_id, from_user_id, to_user_id) VALUES (%s, %s, %s)",
                   (ticket_id, user["user_id"], to["user_id"]))
        tx.execute("UPDATE Tickets SET holder_id = %s, qr_token = %s WHERE ticket_id = %s",
                   (to["user_id"], gateway.new_qr_token(), ticket_id))
    return {"to_name": to["full_name"]}


def refund(user, ticket_id):
    """Price x 90 % / 50 % / 0 % by days before start, never after check-in; booked as a REFUND payment."""
    with transaction() as tx:
        tk = tx.fetch_one(
            """SELECT tk.ticket_id, tk.order_id, tk.status, o.buyer_id, o.status AS order_status,
                      f.organizer_id, f.status AS festival_status
                 FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
                 JOIN TicketTiers ti ON ti.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = ti.festival_id
                WHERE tk.ticket_id = %s FOR UPDATE""", (ticket_id,))
        if not tk:
            raise NotFound("Ticket not found")
        organizer = user["role"] == "ORGANIZER" and tk["organizer_id"] == user["user_id"]
        if tk["buyer_id"] != user["user_id"] and not organizer:
            raise Forbidden("Only the buyer or the festival organizer can refund this ticket")
        tx.execute("SELECT order_id FROM Orders WHERE order_id = %s FOR UPDATE", (tk["order_id"],))
        if tk["order_status"] != "PAID":
            raise Conflict("Only tickets of paid orders can be refunded")
        if tk["status"] == "CHECKED_IN":
            raise Conflict("Checked-in tickets cannot be refunded (rule 6)")
        if tk["status"] != "VALID":
            raise Conflict(f"This ticket is already {tk['status']}")
        if tk["festival_status"] == "CANCELLED":
            raise Conflict("This festival was cancelled; refunds are issued automatically")
        if not organizer and tx.scalar("SELECT COUNT(*) FROM TicketTransfers WHERE ticket_id = %s", (ticket_id,)):
            raise Conflict("Transferred tickets cannot be refunded")

        quote = tx.fetch_one("SELECT * FROM v_ticket_refund_quote WHERE ticket_id = %s", (ticket_id,))
        if not quote["refund_rate"]:
            raise Conflict(f"The festival starts in {quote['days_before_start']} days: "
                           "refunds are not available less than 7 days before (rule 6)")
        if quote["refund_amount"] > 0:
            tx.execute("INSERT INTO Payments (order_id, payment_type, amount, currency, method, status, provider_ref) "
                       "VALUES (%s, 'REFUND', %s, 'TRY', %s, 'CAPTURED', %s)",
                       (tk["order_id"], quote["refund_amount"], first_charge_method(tx, "order_id", tk["order_id"], "CARD"),
                        gateway.refund_reference()))
        tx.execute("UPDATE Tickets SET status = 'REFUNDED' WHERE ticket_id = %s", (ticket_id,))
        if not tx.scalar("SELECT COUNT(*) FROM Tickets WHERE order_id = %s AND status IN ('VALID','CHECKED_IN')",
                         (tk["order_id"],)):
            tx.execute("UPDATE Orders SET status = 'REFUNDED' WHERE order_id = %s", (tk["order_id"],))
    return {"amount": quote["refund_amount"], "rate": quote["refund_rate"], "days_before_start": quote["days_before_start"]}
