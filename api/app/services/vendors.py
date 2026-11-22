"""Vendor eligibility (rule 9), stall allocation (rule 10), fees and cancellations (rule 11)."""
from ..db import db, transaction
from ..errors import Conflict, Forbidden, NotFound, PaymentFailed
from . import gateway
from .festivals import first_charge_method

FEE_DAYS = 7
LATE_CANCEL_DAYS = 21

ALLOC_SELECT = """
    SELECT a.allocation_id, a.vendor_id, a.stall_id, a.status, a.agreed_fee, a.applied_at, a.approved_at, a.reviewed_by,
           b.fee_due_at, b.paid_amount, b.refunded_amount,
           (a.status = 'APPROVED' AND b.paid_amount < a.agreed_fee) AS fee_outstanding,
           GREATEST(TIMESTAMPDIFF(SECOND, NOW(), b.fee_due_at), 0) AS fee_seconds_left,
           v.legal_name, v.category, v.tax_number, v.manager_id, v.status AS vendor_status,
           v.license_expiry, v.hygiene_cert_expiry,
           s.stall_code, s.zone, s.size_m2, s.has_power, s.base_fee,
           f.festival_id, f.name AS festival_name, f.start_date, f.end_date, f.status AS festival_status, f.organizer_id,
           DATEDIFF(f.start_date, CURDATE()) AS days_before_start,
           r.full_name AS reviewer_name
      FROM StallAllocations a
      JOIN v_allocation_balance b ON b.allocation_id = a.allocation_id
      JOIN Vendors v ON v.vendor_id = a.vendor_id
      JOIN Stalls s ON s.stall_id = a.stall_id
      JOIN Festivals f ON f.festival_id = s.festival_id
      LEFT JOIN Users r ON r.user_id = a.reviewed_by"""


def eligibility(vendor, festival):
    """Readable rule 9 verdict. Dates are ISO strings, so string comparison is date comparison."""
    end, problems = festival["end_date"], []
    if vendor["status"] != "ACTIVE":
        problems.append(f"Vendor status is {vendor['status']}; it must be ACTIVE")
    if vendor["license_expiry"] < end:
        problems.append(f"Business license expires {vendor['license_expiry']}, before the festival ends {end}")
    if vendor["category"] in ("FOOD", "BEVERAGE"):
        if not vendor["hygiene_cert_expiry"]:
            problems.append("Food and beverage vendors need a hygiene certificate")
        elif vendor["hygiene_cert_expiry"] < end:
            problems.append(f"Hygiene certificate expires {vendor['hygiene_cert_expiry']}, before the festival ends")
    return {"eligible": not problems, "problems": problems}


def get_allocation(allocation_id):
    return db.fetch_one(f"{ALLOC_SELECT} WHERE a.allocation_id = %s", (allocation_id,))


def _locked(tx, allocation_id):
    a = tx.fetch_one(f"{ALLOC_SELECT} WHERE a.allocation_id = %s FOR UPDATE", (allocation_id,))
    if not a:
        raise NotFound("Application not found")
    return a


def apply(user, vendor_id, stall_id):
    with transaction() as tx:
        v = tx.fetch_one("SELECT * FROM Vendors WHERE vendor_id = %s", (vendor_id,))
        if not v:
            raise NotFound("Vendor not found")
        if v["manager_id"] != user["user_id"]:
            raise Forbidden("You do not manage this vendor")
        stall = tx.fetch_one("""SELECT s.*, f.end_date, f.status AS festival_status FROM Stalls s
                                  JOIN Festivals f ON f.festival_id = s.festival_id WHERE s.stall_id = %s FOR SHARE""",
                             (stall_id,))
        if not stall:
            raise NotFound("Stall not found")
        if stall["festival_status"] in ("COMPLETED", "CANCELLED"):
            raise Conflict("This festival no longer accepts applications")
        verdict = eligibility(v, stall)
        if not verdict["eligible"]:
            raise Conflict(f"Not eligible (rule 9): {'; '.join(verdict['problems'])}")
        if tx.scalar("SELECT COUNT(*) FROM StallAllocations WHERE stall_id = %s AND status = 'APPROVED'", (stall_id,)):
            raise Conflict("This stall is already allocated (rule 10)")
        if tx.scalar("SELECT COUNT(*) FROM StallAllocations WHERE stall_id = %s AND vendor_id = %s AND status = 'APPLIED'",
                     (stall_id, vendor_id)):
            raise Conflict("You already have an open application for this stall")
        return tx.insert("INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee) VALUES (%s, %s, %s)",
                         (vendor_id, stall_id, stall["base_fee"]))


def approve(user, allocation_id, agreed_fee=None):
    """Locks the stall row first so two coordinators cannot both approve; UNIQUE(stall_id, approved_marker) backs it up."""
    with transaction() as tx:
        stall_id = tx.scalar("SELECT stall_id FROM StallAllocations WHERE allocation_id = %s", (allocation_id,))
        if not stall_id:
            raise NotFound("Application not found")
        tx.execute("SELECT stall_id FROM Stalls WHERE stall_id = %s FOR UPDATE", (stall_id,))
        a = _locked(tx, allocation_id)
        if a["organizer_id"] != user["user_id"]:
            raise Forbidden("Only this festival's organizer can review applications")
        if a["status"] != "APPLIED":
            raise Conflict(f"This application is already {a['status']}")
        if tx.scalar("SELECT COUNT(*) FROM StallAllocations WHERE stall_id = %s AND status = 'APPROVED'", (stall_id,)):
            raise Conflict("This stall already has an approved vendor (rule 10)")
        approved = tx.scalar(
            """SELECT COUNT(*) FROM StallAllocations x JOIN Stalls s ON s.stall_id = x.stall_id
                WHERE x.vendor_id = %s AND s.festival_id = %s AND x.status = 'APPROVED'""",
            (a["vendor_id"], a["festival_id"]))
        if approved >= 2:
            raise Conflict("This vendor already has 2 approved stalls at this festival (rule 10)")
        tx.execute("UPDATE StallAllocations SET status = 'APPROVED', approved_at = NOW(), reviewed_by = %s, agreed_fee = %s "
                   "WHERE allocation_id = %s",
                   (user["user_id"], a["agreed_fee"] if agreed_fee is None else agreed_fee, allocation_id))
        tx.execute("UPDATE StallAllocations SET status = 'REJECTED', reviewed_by = %s "
                   "WHERE stall_id = %s AND status = 'APPLIED' AND allocation_id <> %s",
                   (user["user_id"], stall_id, allocation_id))


def reject(user, allocation_id):
    with transaction() as tx:
        a = _locked(tx, allocation_id)
        if a["organizer_id"] != user["user_id"]:
            raise Forbidden("You do not have permission to do this")
        if a["status"] != "APPLIED":
            raise Conflict(f"This application is already {a['status']}")
        tx.execute("UPDATE StallAllocations SET status = 'REJECTED', reviewed_by = %s WHERE allocation_id = %s",
                   (user["user_id"], allocation_id))


def cancel(user, allocation_id):
    """A vendor cancelling a paid stall < 21 days before start forfeits 50 %; otherwise the fee is refunded in full."""
    with transaction() as tx:
        a = _locked(tx, allocation_id)
        vendor = a["manager_id"] == user["user_id"]
        if not vendor and not (user["role"] == "ORGANIZER" and a["organizer_id"] == user["user_id"]):
            raise Forbidden("You do not have permission to do this")
        if a["status"] not in ("APPLIED", "APPROVED"):
            raise Conflict(f"This allocation is already {a['status']}")
        paid = round(a["paid_amount"] - a["refunded_amount"], 2)
        refundable = a["status"] == "APPROVED" and paid > 0
        rate = 0.5 if refundable and vendor and a["days_before_start"] < LATE_CANCEL_DAYS else 1
        refund = round(paid * rate, 2) if refundable else 0
        if refund > 0:
            tx.execute("INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref) "
                       "VALUES (%s, 'REFUND', %s, %s, 'CAPTURED', %s)",
                       (allocation_id, refund, first_charge_method(tx, "allocation_id", allocation_id, "BANK_TRANSFER"),
                        gateway.refund_reference()))
        tx.execute("UPDATE StallAllocations SET status = 'CANCELLED' WHERE allocation_id = %s", (allocation_id,))
    return {"refund": refund, "rate": rate, "forfeited": max(0, round(paid - refund, 2))}


def pay(user, allocation_id, method, card_number):
    with transaction() as tx:
        a = _locked(tx, allocation_id)
        if a["manager_id"] != user["user_id"]:
            raise Forbidden("You do not have permission to do this")
        if a["status"] != "APPROVED":
            raise Conflict("Only approved allocations can be paid")
        if not a["fee_seconds_left"]:
            raise Conflict(f"The {FEE_DAYS}-day payment deadline has passed (rule 11)")
        due = round(a["agreed_fee"] - a["paid_amount"], 2)
        if due <= 0:
            raise Conflict("This stall fee is already paid")
        result = gateway.charge(method, card_number)
        tx.execute("INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref) "
                   "VALUES (%s, 'CHARGE', %s, %s, %s, %s)", (allocation_id, due, method, result.status, result.provider_ref))
    if result.status != "CAPTURED":
        raise PaymentFailed(result.decline_reason or "Payment failed")
    return {"ok": True, "amount": due, "providerRef": result.provider_ref}


def cancel_overdue():
    """Scheduled (rule 11): approved stalls still unpaid 7 days after approval are cancelled."""
    return db.execute(
        f"""UPDATE StallAllocations a SET a.status = 'CANCELLED'
             WHERE a.status = 'APPROVED' AND a.agreed_fee > 0 AND a.approved_at + INTERVAL {FEE_DAYS} DAY < NOW()
               AND (SELECT COALESCE(SUM(p.amount), 0) FROM Payments p
                     WHERE p.allocation_id = a.allocation_id AND p.payment_type = 'CHARGE' AND p.status = 'CAPTURED')
                   < a.agreed_fee""")
