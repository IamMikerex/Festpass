"""
Gate scanning with anti-passback (rule 8). The ticket row is locked FOR UPDATE, so
one QR shown at two gates in the same second is serialised: the second scan sees
the first IN and is recorded as REJECTED_DUPLICATE.
"""
from ..db import db, transaction

REASONS = {
    "UNKNOWN_TOKEN": "QR code not recognised (fake, or replaced after a transfer)",
    "WRONG_FESTIVAL": "Ticket is for a different festival",
    "TICKET_NOT_VALID": "Ticket is refunded, void or unpaid",
    "NOT_LIVE": "Festival is not in progress",
    "ALREADY_INSIDE": "Ticket is already inside (anti-passback)",
    "NOT_INSIDE": "Ticket has no accepted entry to exit from",
    "OK_IN": "Welcome in",
    "OK_OUT": "Exit recorded",
}


def _verdict(tk, last, direction, festival_id):
    if festival_id and festival_id != tk["festival_id"]:
        return "REJECTED_INVALID", "WRONG_FESTIVAL"
    if tk["status"] not in ("VALID", "CHECKED_IN") or tk["order_status"] != "PAID":
        return "REJECTED_INVALID", "TICKET_NOT_VALID"
    if tk["festival_status"] != "LIVE" or not tk["in_dates"]:
        return "REJECTED_NOT_LIVE", "NOT_LIVE"
    inside = bool(last) and last["direction"] == "IN"
    if direction == "IN" and inside:
        return "REJECTED_DUPLICATE", "ALREADY_INSIDE"
    if direction == "OUT" and not inside:
        return "REJECTED_INVALID", "NOT_INSIDE"
    return "ACCEPTED", f"OK_{direction}"


def scan(staff, qr_token, gate_code, direction, festival_id=None):
    with transaction() as tx:
        tk = tx.fetch_one(
            """SELECT tk.ticket_id, tk.status, o.status AS order_status, ti.tier_name,
                      f.festival_id, f.name AS festival_name, f.status AS festival_status,
                      (CURDATE() BETWEEN f.start_date AND f.end_date) AS in_dates, u.full_name AS holder_name
                 FROM Tickets tk
                 JOIN Orders o ON o.order_id = tk.order_id
                 JOIN TicketTiers ti ON ti.tier_id = tk.tier_id
                 JOIN Festivals f ON f.festival_id = ti.festival_id
                 JOIN Users u ON u.user_id = tk.holder_id
                WHERE tk.qr_token = %s FOR UPDATE""", (qr_token,))
        if not tk:  # GateScans.ticket_id is a NOT NULL FK, so an unknown token cannot be logged
            return {"result": "REJECTED_INVALID", "reason_code": "UNKNOWN_TOKEN",
                    "message": REASONS["UNKNOWN_TOKEN"], "recorded": False}

        last = tx.fetch_one(
            """SELECT direction, gate_code, scanned_at FROM GateScans
                WHERE ticket_id = %s AND result = 'ACCEPTED' ORDER BY scanned_at DESC, scan_id DESC LIMIT 1""",
            (tk["ticket_id"],))
        result, reason = _verdict(tk, last, direction, festival_id)
        scan_id = tx.insert("INSERT INTO GateScans (ticket_id, staff_id, gate_code, direction, result) VALUES (%s, %s, %s, %s, %s)",
                            (tk["ticket_id"], staff["user_id"], gate_code, direction, result))
        checks_in = result == "ACCEPTED" and direction == "IN"
        if checks_in and tk["status"] == "VALID":
            tx.execute("UPDATE Tickets SET status = 'CHECKED_IN' WHERE ticket_id = %s", (tk["ticket_id"],))

    return {
        "scan_id": scan_id, "result": result, "reason_code": reason, "message": REASONS[reason], "recorded": True,
        "ticket": {"ticket_id": tk["ticket_id"], "holder_name": tk["holder_name"], "tier_name": tk["tier_name"],
                   "festival_name": tk["festival_name"], "status": "CHECKED_IN" if checks_in else tk["status"]},
        "previous_scan": last,
    }


def recent_for(staff, limit=25):
    return db.fetch_all(
        """SELECT gs.scan_id, gs.scanned_at, gs.gate_code, gs.direction, gs.result, u.full_name AS holder_name,
                  ti.tier_name, f.name AS festival_name
             FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id
             JOIN Users u ON u.user_id = tk.holder_id JOIN TicketTiers ti ON ti.tier_id = tk.tier_id
             JOIN Festivals f ON f.festival_id = ti.festival_id
            WHERE gs.staff_id = %s ORDER BY gs.scanned_at DESC LIMIT %s""", (staff["user_id"], limit))


def festivals_today():
    return db.fetch_all(
        """SELECT f.festival_id, f.name, f.city, f.venue_name, f.status, f.start_date, f.end_date,
                  (SELECT COUNT(*) FROM v_ticket_last_scan ls JOIN Tickets tk ON tk.ticket_id = ls.ticket_id
                     JOIN TicketTiers t ON t.tier_id = tk.tier_id
                    WHERE t.festival_id = f.festival_id AND ls.direction = 'IN') AS inside_now
             FROM Festivals f WHERE f.status IN ('LIVE','ON_SALE') ORDER BY f.status = 'LIVE' DESC, f.start_date""")
