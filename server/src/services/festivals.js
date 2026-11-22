const db = require('../db');
const gateway = require('./gateway');
const { conflict, forbidden, notFound, badRequest } = require('../utils/errors');

async function loadOwned(t, user, festivalId, lock = '') {
  const f = await t.one(`SELECT * FROM Festivals WHERE festival_id = ? ${lock}`, [festivalId]);
  if (!f) throw notFound('Festival not found');
  if (user.role !== 'ORGANIZER' || f.organizer_id !== user.user_id) throw forbidden('Only this festival\'s organizer can do that');
  return f;
}

const NEXT = { DRAFT: ['ON_SALE', 'CANCELLED'], ON_SALE: ['LIVE', 'CANCELLED'], LIVE: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };

/**
 * Rule 7: cancelling refunds every non-refunded ticket at 100 % (one REFUND row per order),
 * voids pending checkouts, and annuls approved stall allocations with full fee reimbursement.
 */
async function cancelFestival(t, festival) {
  const summary = { orders_refunded: 0, tickets_refunded: 0, amount_refunded: 0, pending_cancelled: 0, allocations_cancelled: 0, fees_refunded: 0 };

  const pending = await t.query("SELECT order_id FROM Orders WHERE festival_id = ? AND status = 'PENDING' FOR UPDATE", [festival.festival_id]);
  for (const o of pending) {
    await t.query("UPDATE Tickets SET status = 'VOID' WHERE order_id = ? AND status = 'VALID'", [o.order_id]);
    await t.query("UPDATE Orders SET status = 'CANCELLED' WHERE order_id = ?", [o.order_id]);
    summary.pending_cancelled += 1;
  }

  const paid = await t.query("SELECT order_id FROM Orders WHERE festival_id = ? AND status = 'PAID' FOR UPDATE", [festival.festival_id]);
  for (const o of paid) {
    const live = await t.one(
      `SELECT COUNT(*) AS n, COALESCE(SUM(ti.price), 0) AS value FROM Tickets tk JOIN TicketTiers ti ON ti.tier_id = tk.tier_id
        WHERE tk.order_id = ? AND tk.status IN ('VALID','CHECKED_IN')`,
      [o.order_id],
    );
    const bal = await t.one('SELECT captured_amount, refunded_amount FROM v_order_totals WHERE order_id = ?', [o.order_id]);
    const refundable = Math.min(Number(live.value), Number(bal.captured_amount) - Number(bal.refunded_amount));
    if (refundable > 0) {
      const charge = await t.one(
        "SELECT method FROM Payments WHERE order_id = ? AND payment_type = 'CHARGE' AND status = 'CAPTURED' ORDER BY payment_id LIMIT 1",
        [o.order_id],
      );
      await t.query(
        `INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref)
         VALUES (?, 'REFUND', ?, ?, 'CAPTURED', ?)`,
        [o.order_id, refundable.toFixed(2), charge ? charge.method : 'CARD', gateway.refund().providerRef],
      );
      summary.amount_refunded += refundable;
    }
    await t.query("UPDATE Tickets SET status = 'REFUNDED' WHERE order_id = ? AND status IN ('VALID','CHECKED_IN')", [o.order_id]);
    await t.query("UPDATE Orders SET status = 'REFUNDED' WHERE order_id = ?", [o.order_id]);
    summary.orders_refunded += 1;
    summary.tickets_refunded += live.n;
  }

  const allocs = await t.query(
    `SELECT a.allocation_id, a.status FROM StallAllocations a JOIN Stalls s ON s.stall_id = a.stall_id
      WHERE s.festival_id = ? AND a.status IN ('APPLIED','APPROVED') FOR UPDATE`,
    [festival.festival_id],
  );
  for (const a of allocs) {
    if (a.status === 'APPROVED') {
      const bal = await t.one('SELECT paid_amount, refunded_amount FROM v_allocation_balance WHERE allocation_id = ?', [a.allocation_id]);
      const due = Number(bal.paid_amount) - Number(bal.refunded_amount);
      if (due > 0) {
        await t.query(
          `INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref)
           VALUES (?, 'REFUND', ?, 'BANK_TRANSFER', 'CAPTURED', ?)`,
          [a.allocation_id, due.toFixed(2), gateway.refund().providerRef],
        );
        summary.fees_refunded += due;
      }
      await t.query("UPDATE StallAllocations SET status = 'CANCELLED' WHERE allocation_id = ?", [a.allocation_id]);
      summary.allocations_cancelled += 1;
    } else {
      await t.query("UPDATE StallAllocations SET status = 'REJECTED' WHERE allocation_id = ?", [a.allocation_id]);
    }
  }
  return summary;
}

async function changeStatus(user, festivalId, status) {
  return db.tx(async (t) => {
    const f = await loadOwned(t, user, festivalId, 'FOR UPDATE');
    if (!NEXT[f.status].includes(status)) {
      throw conflict(`A ${f.status} festival can move to: ${NEXT[f.status].join(', ') || 'nothing (final state)'} (rule 12)`);
    }
    if (status === 'ON_SALE') {
      const n = await t.one('SELECT COUNT(*) AS n FROM TicketTiers WHERE festival_id = ?', [festivalId]);
      if (!n.n) throw conflict('Add at least one ticket tier before opening sales');
    }
    await t.query('UPDATE Festivals SET status = ? WHERE festival_id = ?', [status, festivalId]);
    let summary = null;
    if (status === 'CANCELLED') summary = await cancelFestival(t, f);
    return { status, summary };
  });
}

/** Scheduled job: ON_SALE -> LIVE on the start date, LIVE -> COMPLETED after the end date (rule 12). */
async function advanceLifecycle() {
  const a = await db.query("UPDATE Festivals SET status = 'LIVE' WHERE status = 'ON_SALE' AND start_date <= CURDATE() AND end_date >= CURDATE()");
  const b = await db.query("UPDATE Festivals SET status = 'COMPLETED' WHERE status = 'LIVE' AND end_date < CURDATE()");
  return a.affectedRows + b.affectedRows;
}

async function assertEditable(f, fields) {
  if (['COMPLETED', 'CANCELLED'].includes(f.status)) throw conflict(`A ${f.status} festival can no longer be edited`);
  if (f.status !== 'DRAFT' && (fields.start_date || fields.end_date || fields.min_age !== undefined)) {
    const sold = await db.one(
      `SELECT COUNT(*) AS n FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = ?`,
      [f.festival_id],
    );
    if (sold.n > 0) throw conflict('Dates and age limit are locked once tickets have been sold');
  }
}

function validateTierWindow(tier, festival) {
  if (tier.sale_start && tier.sale_end && new Date(tier.sale_end) <= new Date(tier.sale_start)) {
    throw badRequest('Sale end must be after sale start');
  }
  if (tier.sale_end && festival && new Date(tier.sale_end) > new Date(`${festival.end_date}T23:59:59`)) {
    throw badRequest('Ticket sales must end before the festival ends');
  }
}

module.exports = { loadOwned, changeStatus, cancelFestival, advanceLifecycle, assertEditable, validateTierWindow, NEXT };
