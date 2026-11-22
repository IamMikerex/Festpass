"""Checkout: holds (rule 3), per-order and per-festival limits (rule 1), hard quotas (rule 2), age (rule 4)."""
from ..db import db, transaction
from ..errors import BadRequest, Conflict, Forbidden, Gone, NotFound, PaymentFailed
from . import gateway

MAX_PER_FESTIVAL = 10
HOLD_MINUTES = 10

ORDER_SELECT = """
    SELECT ot.*, f.name AS festival_name, f.city, f.venue_name, f.start_date, f.end_date,
           GREATEST(TIMESTAMPDIFF(SECOND, NOW(), ot.expires_at), 0) AS seconds_left
      FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id"""


def _merge(items):
    """Folds repeated tiers into one line each, sorted by id so concurrent checkouts lock rows in the same order."""
    lines = {}
    for item in items:
        line = lines.setdefault(item.tier_id, {"tier_id": item.tier_id, "quantity": 0, "holders": []})
        line["quantity"] += item.quantity
        line["holders"] += item.holder_emails
    return sorted(lines.values(), key=lambda line: line["tier_id"])


def create_order(buyer, festival_id, items):
    lines = _merge(items)
    total = sum(line["quantity"] for line in lines)

    with transaction() as tx:
        fest = tx.fetch_one("SELECT * FROM Festivals WHERE festival_id = %s FOR SHARE", (festival_id,))
        if not fest:
            raise NotFound("Festival not found")
        if fest["status"] != "ON_SALE":
            raise Conflict("Tickets can only be bought while the festival is ON_SALE (rule 12)")

        tiers = {t["tier_id"]: t for t in tx.fetch_all(
            """SELECT tier_id, festival_id, tier_name, price, quota, max_per_order,
                      (NOW() BETWEEN sale_start AND sale_end) AS in_window
                 FROM TicketTiers WHERE tier_id IN %s ORDER BY tier_id FOR UPDATE""",
            (tuple(line["tier_id"] for line in lines),))}
        if len(tiers) != len(lines):
            raise NotFound("Ticket tier not found")

        held = tx.scalar(
            """SELECT COUNT(*) FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
                WHERE o.buyer_id = %s AND o.festival_id = %s AND o.status IN ('PENDING','PAID')
                  AND tk.status IN ('VALID','CHECKED_IN')""", (buyer["user_id"], festival_id))
        if held + total > MAX_PER_FESTIVAL:
            raise Conflict(f"You can hold at most {MAX_PER_FESTIVAL} tickets for this festival; "
                           f"you already have {held} (rule 1)")

        for line in lines:
            tier = tiers[line["tier_id"]]
            if tier["festival_id"] != festival_id:
                raise BadRequest("Tier does not belong to this festival")
            if not tier["in_window"]:
                raise Conflict(f"{tier['tier_name']} is not on sale right now")
            if line["quantity"] > tier["max_per_order"]:
                raise Conflict(f"At most {tier['max_per_order']} {tier['tier_name']} tickets per order (rule 1)")
            used = tx.scalar("SELECT COUNT(*) FROM Tickets WHERE tier_id = %s AND status IN ('VALID','CHECKED_IN')",
                             (tier["tier_id"],))
            left = max(0, tier["quota"] - used)
            if line["quantity"] > left:
                raise Conflict(f"Only {left} {tier['tier_name']} tickets left" if left else f"{tier['tier_name']} is sold out")

        # Named holders (rule 4); an empty slot belongs to the buyer.
        slots = [(line["tier_id"], line["holders"][i] if i < len(line["holders"]) else "")
                 for line in lines for i in range(line["quantity"])]
        holders = _eligible_holders(tx, fest, {email for _, email in slots if email})
        if any(not email for _, email in slots):
            age = tx.scalar("SELECT TIMESTAMPDIFF(YEAR, date_of_birth, %s) FROM Users WHERE user_id = %s",
                            (fest["start_date"], buyer["user_id"]))
            if age < fest["min_age"]:
                raise Conflict(f"You will be under {fest['min_age']} on the festival start date (rule 4). "
                               "Assign the ticket to an eligible holder.")

        order_id = tx.insert(
            f"INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at) "
            f"VALUES (%s, %s, 'PENDING', NOW(), NOW() + INTERVAL {HOLD_MINUTES} MINUTE)", (buyer["user_id"], festival_id))
        for tier_id, email in slots:
            tx.execute("INSERT INTO Tickets (ticket_id, order_id, tier_id, holder_id, qr_token) VALUES (UUID(), %s, %s, %s, %s)",
                       (order_id, tier_id, holders[email] if email else buyer["user_id"], gateway.new_qr_token()))

        if not tx.scalar("SELECT total_amount FROM v_order_totals WHERE order_id = %s", (order_id,)):
            # Free tickets need no payment row (amount > 0 CHECK): confirm straight away.
            tx.execute("UPDATE Orders SET status = 'PAID', paid_at = NOW() WHERE order_id = %s", (order_id,))
    return order_id


def _eligible_holders(tx, fest, emails):
    if not emails:
        return {}
    users = {u["email"].lower(): u for u in tx.fetch_all(
        "SELECT user_id, email, full_name, account_status, TIMESTAMPDIFF(YEAR, date_of_birth, %s) AS age "
        "FROM Users WHERE email IN %s", (fest["start_date"], tuple(emails)))}
    for email in sorted(emails):
        u = users.get(email)
        if not u or u["account_status"] != "ACTIVE":
            raise BadRequest(f"{email} is not a registered FestPass user")
        if u["age"] < fest["min_age"]:
            raise Conflict(f"{u['full_name']} will be under {fest['min_age']} on the festival start date (rule 4)")
    return {email: u["user_id"] for email, u in users.items()}


def get_order(order_id):
    order = db.fetch_one(f"{ORDER_SELECT} WHERE ot.order_id = %s", (order_id,))
    if order:
        order["tickets"] = db.fetch_all(
            """SELECT tk.ticket_id, tk.status, tk.issued_at, t.tier_name, t.price,
                      u.full_name AS holder_name, u.email AS holder_email
                 FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Users u ON u.user_id = tk.holder_id
                WHERE tk.order_id = %s ORDER BY t.tier_name, tk.issued_at""", (order_id,))
        order["payments"] = db.fetch_all("SELECT * FROM Payments WHERE order_id = %s ORDER BY processed_at, payment_id",
                                         (order_id,))
    return order


def expire_locked(tx, order_id):
    tx.execute("UPDATE Tickets SET status = 'VOID' WHERE order_id = %s AND status = 'VALID'", (order_id,))
    tx.execute("UPDATE Orders SET status = 'EXPIRED' WHERE order_id = %s AND status = 'PENDING'", (order_id,))


def apply_charge(tx, order_id, amount, method, provider_ref, status):
    """Records a CHARGE on a locked order; marks it PAID once fully covered. Shared by checkout and the webhook."""
    tx.execute("INSERT INTO Payments (order_id, payment_type, amount, currency, method, status, provider_ref) "
               "VALUES (%s, 'CHARGE', %s, 'TRY', %s, %s, %s)", (order_id, amount, method, status, provider_ref))
    if status != "CAPTURED":
        return False
    totals = tx.fetch_one("SELECT total_amount, captured_amount FROM v_order_totals WHERE order_id = %s", (order_id,))
    if totals["captured_amount"] + 0.001 < totals["total_amount"]:
        return False
    tx.execute("UPDATE Orders SET status = 'PAID', paid_at = NOW() WHERE order_id = %s AND status = 'PENDING'", (order_id,))
    return True


def pay_order(user, order_id, method, card_number):
    # Expiry and declines are committed first (EXPIRED status, FAILED payment row), then reported.
    with transaction() as tx:
        order = tx.fetch_one("SELECT o.*, (o.expires_at < NOW()) AS is_expired FROM Orders o WHERE order_id = %s FOR UPDATE",
                             (order_id,))
        if not order:
            raise NotFound("Order not found")
        if order["buyer_id"] != user["user_id"]:
            raise Forbidden("You do not have permission to do this")
        if order["status"] != "PENDING":
            raise Conflict(f"This order is already {order['status']}")
        expired = bool(order["is_expired"])
        if expired:
            expire_locked(tx, order_id)
        else:
            totals = tx.fetch_one("SELECT total_amount, captured_amount FROM v_order_totals WHERE order_id = %s", (order_id,))
            result = gateway.charge(method, card_number)
            paid = apply_charge(tx, order_id, round(totals["total_amount"] - totals["captured_amount"], 2),
                                method, result.provider_ref, result.status)
    if expired:
        raise Gone("Your 10-minute checkout hold expired and the tickets were released (rule 3)")
    if not paid:
        raise PaymentFailed(result.decline_reason or "Payment failed")
    return {"paid": True, "providerRef": result.provider_ref}


def cancel_pending(user, order_id):
    with transaction() as tx:
        order = tx.fetch_one("SELECT * FROM Orders WHERE order_id = %s FOR UPDATE", (order_id,))
        if not order:
            raise NotFound("Order not found")
        if order["buyer_id"] != user["user_id"]:
            raise Forbidden("You do not have permission to do this")
        if order["status"] != "PENDING":
            raise Conflict("Only pending orders can be cancelled; use a refund for paid tickets")
        tx.execute("UPDATE Tickets SET status = 'VOID' WHERE order_id = %s AND status = 'VALID'", (order_id,))
        tx.execute("UPDATE Orders SET status = 'CANCELLED' WHERE order_id = %s", (order_id,))


def expire_stale():
    """Scheduled (rule 3). SKIP LOCKED leaves orders that are mid-payment alone."""
    with transaction() as tx:
        stale = tx.fetch_all("SELECT order_id FROM Orders WHERE status = 'PENDING' AND expires_at < NOW() FOR UPDATE SKIP LOCKED")
        for o in stale:
            expire_locked(tx, o["order_id"])
    return len(stale)
