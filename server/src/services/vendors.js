const db = require('../db');
const gateway = require('./gateway');
const { conflict, forbidden, notFound, badRequest, HttpError } = require('../utils/errors');

const FEE_DAYS = 7;          // rule 11: pay within 7 days of approval
const LATE_CANCEL_DAYS = 21; // rule 11: < 21 days before start => 50 % forfeited

const ALLOC_SELECT = `
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
    LEFT JOIN Users r ON r.user_id = a.reviewed_by`;

/** Rule 9 eligibility of a vendor for a festival, as a readable verdict. */
function eligibility(vendor, festival) {
  const problems = [];
  if (vendor.status !== 'ACTIVE') problems.push(`Vendor status is ${vendor.status}; it must be ACTIVE`);
  if (vendor.license_expiry < festival.end_date) problems.push(`Business license expires ${vendor.license_expiry}, before the festival ends ${festival.end_date}`);
  if (['FOOD', 'BEVERAGE'].includes(vendor.category)) {
    if (!vendor.hygiene_cert_expiry) problems.push('Food and beverage vendors need a hygiene certificate');
    else if (vendor.hygiene_cert_expiry < festival.end_date) problems.push(`Hygiene certificate expires ${vendor.hygiene_cert_expiry}, before the festival ends`);
  }
  return { eligible: problems.length === 0, problems };
}

async function apply(user, { vendor_id, stall_id }) {
  return db.tx(async (t) => {
    const v = await t.one('SELECT * FROM Vendors WHERE vendor_id = ?', [vendor_id]);
    if (!v) throw notFound('Vendor not found');
    if (v.manager_id !== user.user_id) throw forbidden('You do not manage this vendor');
    const s = await t.one(
      `SELECT s.*, f.end_date, f.status AS festival_status, f.festival_id FROM Stalls s
         JOIN Festivals f ON f.festival_id = s.festival_id WHERE s.stall_id = ? FOR SHARE`,
      [stall_id],
    );
    if (!s) throw notFound('Stall not found');
    if (['COMPLETED', 'CANCELLED'].includes(s.festival_status)) throw conflict('This festival no longer accepts applications');
    const el = eligibility(v, s);
    if (!el.eligible) throw conflict(`Not eligible (rule 9): ${el.problems.join('; ')}`);
    const taken = await t.one("SELECT 1 AS x FROM StallAllocations WHERE stall_id = ? AND status = 'APPROVED'", [stall_id]);
    if (taken) throw conflict('This stall is already allocated (rule 10)');
    const dup = await t.one("SELECT 1 AS x FROM StallAllocations WHERE stall_id = ? AND vendor_id = ? AND status = 'APPLIED'", [stall_id, vendor_id]);
    if (dup) throw conflict('You already have an open application for this stall');
    const r = await t.query('INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee) VALUES (?, ?, ?)', [vendor_id, stall_id, s.base_fee]);
    return r.insertId;
  });
}

async function getAllocation(id) {
  return db.one(`${ALLOC_SELECT} WHERE a.allocation_id = ?`, [id]);
}

/**
 * Approve: locks the stall row first (Part 3 d, case 3) so two coordinators cannot both
 * approve; the UNIQUE(stall_id, approved_marker) index is the last line of defence.
 */
async function approve(user, allocationId, { agreed_fee }) {
  return db.tx(async (t) => {
    const a0 = await t.one('SELECT stall_id FROM StallAllocations WHERE allocation_id = ?', [allocationId]);
    if (!a0) throw notFound('Application not found');
    await t.one('SELECT stall_id FROM Stalls WHERE stall_id = ? FOR UPDATE', [a0.stall_id]);
    const a = await t.one(`${ALLOC_SELECT} WHERE a.allocation_id = ? FOR UPDATE`, [allocationId]);
    if (a.organizer_id !== user.user_id) throw forbidden('Only this festival\'s organizer can review applications');
    if (a.status !== 'APPLIED') throw conflict(`This application is already ${a.status}`);
    const taken = await t.one("SELECT allocation_id FROM StallAllocations WHERE stall_id = ? AND status = 'APPROVED'", [a.stall_id]);
    if (taken) throw conflict('This stall already has an approved vendor (rule 10)');
    const count = await t.one(
      `SELECT COUNT(*) AS n FROM StallAllocations x JOIN Stalls s ON s.stall_id = x.stall_id
        WHERE x.vendor_id = ? AND s.festival_id = ? AND x.status = 'APPROVED'`,
      [a.vendor_id, a.festival_id],
    );
    if (count.n >= 2) throw conflict('This vendor already has 2 approved stalls at this festival (rule 10)');
    const fee = agreed_fee ?? a.agreed_fee;
    await t.query(
      "UPDATE StallAllocations SET status = 'APPROVED', approved_at = NOW(), reviewed_by = ?, agreed_fee = ? WHERE allocation_id = ?",
      [user.user_id, fee, allocationId],
    );
    // Other open applications for the same stall can no longer succeed.
    await t.query(
      "UPDATE StallAllocations SET status = 'REJECTED', reviewed_by = ? WHERE stall_id = ? AND status = 'APPLIED' AND allocation_id <> ?",
      [user.user_id, a.stall_id, allocationId],
    );
  });
}

async function reject(user, allocationId) {
  return db.tx(async (t) => {
    const a = await t.one(`${ALLOC_SELECT} WHERE a.allocation_id = ? FOR UPDATE`, [allocationId]);
    if (!a) throw notFound('Application not found');
    if (a.organizer_id !== user.user_id) throw forbidden();
    if (a.status !== 'APPLIED') throw conflict(`This application is already ${a.status}`);
    await t.query("UPDATE StallAllocations SET status = 'REJECTED', reviewed_by = ? WHERE allocation_id = ?", [user.user_id, allocationId]);
  });
}

/**
 * Rule 11 cancellation. Vendor cancelling a paid allocation < 21 days before start forfeits 50 %;
 * earlier (or organizer-initiated) cancellations are refunded in full.
 */
async function cancel(user, allocationId) {
  return db.tx(async (t) => {
    const a = await t.one(`${ALLOC_SELECT} WHERE a.allocation_id = ? FOR UPDATE`, [allocationId]);
    if (!a) throw notFound('Application not found');
    const isVendor = a.manager_id === user.user_id;
    const isOrganizer = user.role === 'ORGANIZER' && a.organizer_id === user.user_id;
    if (!isVendor && !isOrganizer) throw forbidden();
    if (!['APPLIED', 'APPROVED'].includes(a.status)) throw conflict(`This allocation is already ${a.status}`);
    let refund = 0;
    let rate = 1;
    const paid = Number(a.paid_amount) - Number(a.refunded_amount);
    if (a.status === 'APPROVED' && paid > 0) {
      rate = isVendor && a.days_before_start < LATE_CANCEL_DAYS ? 0.5 : 1;
      refund = Math.round(paid * rate * 100) / 100;
      if (refund > 0) {
        const charge = await t.one(
          "SELECT method FROM Payments WHERE allocation_id = ? AND payment_type = 'CHARGE' AND status = 'CAPTURED' ORDER BY payment_id LIMIT 1",
          [allocationId],
        );
        await t.query(
          `INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref)
           VALUES (?, 'REFUND', ?, ?, 'CAPTURED', ?)`,
          [allocationId, refund, charge ? charge.method : 'BANK_TRANSFER', gateway.refund().providerRef],
        );
      }
    }
    await t.query("UPDATE StallAllocations SET status = 'CANCELLED' WHERE allocation_id = ?", [allocationId]);
    return { refund, rate, forfeited: Math.max(0, Math.round((paid - refund) * 100) / 100) };
  });
}

async function pay(user, allocationId, { method, card_number }) {
  const out = await db.tx(async (t) => {
    const a = await t.one(
      `${ALLOC_SELECT} WHERE a.allocation_id = ? FOR UPDATE`,
      [allocationId],
    );
    if (!a) throw notFound('Allocation not found');
    if (a.manager_id !== user.user_id) throw forbidden();
    if (a.status !== 'APPROVED') throw conflict('Only approved allocations can be paid');
    if (!a.fee_seconds_left) throw conflict(`The ${FEE_DAYS}-day payment deadline has passed (rule 11)`);
    const due = Math.round((Number(a.agreed_fee) - Number(a.paid_amount)) * 100) / 100;
    if (due <= 0) throw conflict('This stall fee is already paid');
    const g = gateway.charge({ method, cardNumber: card_number });
    await t.query(
      `INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref)
       VALUES (?, 'CHARGE', ?, ?, ?, ?)`,
      [allocationId, due, method, g.status, g.providerRef],
    );
    return { ok: g.status === 'CAPTURED', amount: due, reason: g.declineReason, providerRef: g.providerRef };
  });
  if (!out.ok) throw new HttpError(402, out.reason || 'Payment failed');
  return out;
}

/** Scheduled job (rule 11): approved allocations unpaid after 7 days are CANCELLED. */
async function cancelOverdueAllocations() {
  const r = await db.query(
    `UPDATE StallAllocations a
        SET a.status = 'CANCELLED'
      WHERE a.status = 'APPROVED' AND a.agreed_fee > 0
        AND a.approved_at + INTERVAL ${FEE_DAYS} DAY < NOW()
        AND (SELECT COALESCE(SUM(p.amount), 0) FROM Payments p
              WHERE p.allocation_id = a.allocation_id AND p.payment_type = 'CHARGE' AND p.status = 'CAPTURED') < a.agreed_fee`,
  );
  return r.affectedRows;
}

module.exports = { ALLOC_SELECT, eligibility, apply, approve, reject, cancel, pay, getAllocation, cancelOverdueAllocations, FEE_DAYS, LATE_CANCEL_DAYS };
