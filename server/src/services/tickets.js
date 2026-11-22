const db = require('../db');
const gateway = require('./gateway');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');

const TICKET_SELECT = `
  SELECT tk.ticket_id, tk.order_id, tk.tier_id, tk.holder_id, tk.status, tk.issued_at,
         t.tier_name, t.price, f.festival_id, f.name AS festival_name, f.venue_name, f.city,
         f.start_date, f.end_date, f.status AS festival_status, f.organizer_id,
         o.status AS order_status, o.buyer_id,
         hu.full_name AS holder_name, hu.email AS holder_email,
         bu.full_name AS buyer_name,
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
    LEFT JOIN v_ticket_last_scan ls ON ls.ticket_id = tk.ticket_id`;

function decorate(tk, user) {
  if (!tk) return tk;
  const transferred = tk.transfer_count > 0;
  tk.can_transfer = tk.holder_id === user.user_id && tk.status === 'VALID' && tk.order_status === 'PAID'
    && !transferred && !!tk.transfer_window_open && ['ON_SALE', 'LIVE'].includes(tk.festival_status);
  tk.can_refund = tk.buyer_id === user.user_id && !!tk.refundable && !transferred && tk.festival_status !== 'CANCELLED';
  tk.refund_block_reason = null;
  if (!tk.can_refund) {
    if (tk.status === 'CHECKED_IN') tk.refund_block_reason = 'Checked-in tickets cannot be refunded (rule 6)';
    else if (tk.status !== 'VALID') tk.refund_block_reason = `Ticket is ${tk.status}`;
    else if (transferred) tk.refund_block_reason = 'Transferred tickets cannot be refunded';
    else if (tk.buyer_id !== user.user_id) tk.refund_block_reason = 'Only the buyer can request a refund';
    else if (tk.days_before_start < 7) tk.refund_block_reason = 'Less than 7 days before the festival: no refund (rule 6)';
  }
  tk.transfer_block_reason = null;
  if (!tk.can_transfer) {
    if (transferred) tk.transfer_block_reason = 'This ticket has already been transferred once (rule 5)';
    else if (tk.status !== 'VALID') tk.transfer_block_reason = `Ticket is ${tk.status}`;
    else if (!tk.transfer_window_open) tk.transfer_block_reason = 'Transfers close 48 hours before the festival (rule 5)';
  }
  return tk;
}

/** Tickets the user holds (QR only exposed for paid, non-void tickets). */
async function listMine(user) {
  const rows = await db.query(
    `${TICKET_SELECT} WHERE tk.holder_id = ? AND o.status IN ('PAID','REFUNDED','CANCELLED')
       ORDER BY f.start_date, t.tier_name`,
    [user.user_id],
  );
  return rows.map((r) => decorate(r, user));
}

async function getTicket(user, ticketId, { includeQr = false } = {}) {
  const tk = await db.one(`${TICKET_SELECT} WHERE tk.ticket_id = ?`, [ticketId]);
  if (!tk) throw notFound('Ticket not found');
  const isOwnerSide = tk.holder_id === user.user_id || tk.buyer_id === user.user_id;
  const isStaff = (user.role === 'ORGANIZER' && tk.organizer_id === user.user_id) || user.role === 'AUDITOR';
  if (!isOwnerSide && !isStaff) throw forbidden();
  decorate(tk, user);
  // The QR token is the admission secret: only the current holder of a paid ticket sees it.
  if (includeQr && tk.holder_id === user.user_id && tk.order_status === 'PAID' && ['VALID', 'CHECKED_IN'].includes(tk.status)) {
    const r = await db.one('SELECT qr_token FROM Tickets WHERE ticket_id = ?', [ticketId]);
    tk.qr_token = r.qr_token;
  }
  return tk;
}

async function history(user, ticketId) {
  await getTicket(user, ticketId);
  const transfers = await db.query(
    `SELECT tt.transferred_at, fu.full_name AS from_name, tu.full_name AS to_name
       FROM TicketTransfers tt JOIN Users fu ON fu.user_id = tt.from_user_id JOIN Users tu ON tu.user_id = tt.to_user_id
      WHERE tt.ticket_id = ?`,
    [ticketId],
  );
  const scans = await db.query(
    `SELECT gs.scanned_at, gs.gate_code, gs.direction, gs.result, u.full_name AS staff_name
       FROM GateScans gs JOIN Users u ON u.user_id = gs.staff_id WHERE gs.ticket_id = ? ORDER BY gs.scanned_at DESC`,
    [ticketId],
  );
  return { transfers, scans };
}

/**
 * Rule 5: one transfer, VALID tickets only, closes 48 h before start; regenerates the QR token.
 * The ticket row is locked so a concurrent refund cannot interleave (Part 3 d, case 4).
 */
async function transfer(user, ticketId, { email }) {
  return db.tx(async (t) => {
    const tk = await t.one(
      `SELECT tk.*, f.start_date, f.min_age, f.status AS festival_status,
              (NOW() <= TIMESTAMP(f.start_date) - INTERVAL 48 HOUR) AS window_open
         FROM Tickets tk JOIN TicketTiers ti ON ti.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = ti.festival_id
        WHERE tk.ticket_id = ? FOR UPDATE`,
      [ticketId],
    );
    if (!tk) throw notFound('Ticket not found');
    if (tk.holder_id !== user.user_id) throw forbidden('Only the current holder can transfer this ticket');
    if (tk.status !== 'VALID') throw conflict(`Only VALID tickets can be transferred; this one is ${tk.status} (rule 5)`);
    if (!tk.window_open) throw conflict('Transfers close 48 hours before the festival starts (rule 5)');
    const prior = await t.one('SELECT transfer_id FROM TicketTransfers WHERE ticket_id = ?', [ticketId]);
    if (prior) throw conflict('This ticket has already been transferred once (rule 5)');

    const to = await t.one(
      'SELECT user_id, full_name, account_status, TIMESTAMPDIFF(YEAR, date_of_birth, ?) AS age FROM Users WHERE email = ?',
      [tk.start_date, email.toLowerCase()],
    );
    if (!to || to.account_status !== 'ACTIVE') throw badRequest('The recipient must have an active FestPass account');
    if (to.user_id === user.user_id) throw badRequest('You cannot transfer a ticket to yourself');
    if (to.age < tk.min_age) throw conflict(`${to.full_name} is under the festival minimum age of ${tk.min_age} (rule 4)`);

    await t.query('INSERT INTO TicketTransfers (ticket_id, from_user_id, to_user_id) VALUES (?, ?, ?)', [
      ticketId, user.user_id, to.user_id,
    ]);
    await t.query('UPDATE Tickets SET holder_id = ?, qr_token = ? WHERE ticket_id = ?', [
      to.user_id, gateway.newQrToken(), ticketId,
    ]);
    return { to_name: to.full_name };
  });
}

/** Rule 6 refund: price x (90 % / 50 % / 0 %), never after check-in, recorded as a REFUND payment row. */
async function refund(user, ticketId) {
  return db.tx(async (t) => {
    const tk = await t.one(
      `SELECT tk.ticket_id, tk.order_id, tk.status, o.buyer_id, o.status AS order_status,
              f.organizer_id, f.status AS festival_status
         FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
         JOIN TicketTiers ti ON ti.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = ti.festival_id
        WHERE tk.ticket_id = ? FOR UPDATE`,
      [ticketId],
    );
    if (!tk) throw notFound('Ticket not found');
    const isOrganizer = user.role === 'ORGANIZER' && tk.organizer_id === user.user_id;
    if (tk.buyer_id !== user.user_id && !isOrganizer) throw forbidden('Only the buyer or the festival organizer can refund this ticket');
    await t.one('SELECT order_id FROM Orders WHERE order_id = ? FOR UPDATE', [tk.order_id]);
    if (tk.order_status !== 'PAID') throw conflict('Only tickets of paid orders can be refunded');
    if (tk.status === 'CHECKED_IN') throw conflict('Checked-in tickets cannot be refunded (rule 6)');
    if (tk.status !== 'VALID') throw conflict(`This ticket is already ${tk.status}`);
    if (tk.festival_status === 'CANCELLED') throw conflict('This festival was cancelled; refunds are issued automatically');
    if (!isOrganizer) {
      const tr = await t.one('SELECT 1 AS x FROM TicketTransfers WHERE ticket_id = ?', [ticketId]);
      if (tr) throw conflict('Transferred tickets cannot be refunded');
    }

    const q = await t.one('SELECT * FROM v_ticket_refund_quote WHERE ticket_id = ?', [ticketId]);
    if (Number(q.refund_rate) === 0) {
      throw conflict(`The festival starts in ${q.days_before_start} days: refunds are not available less than 7 days before (rule 6)`);
    }
    const amount = Number(q.refund_amount);
    if (amount > 0) {
      const charge = await t.one(
        "SELECT method FROM Payments WHERE order_id = ? AND payment_type = 'CHARGE' AND status = 'CAPTURED' ORDER BY payment_id LIMIT 1",
        [tk.order_id],
      );
      const r = gateway.refund();
      await t.query(
        `INSERT INTO Payments (order_id, payment_type, amount, currency, method, status, provider_ref)
         VALUES (?, 'REFUND', ?, 'TRY', ?, 'CAPTURED', ?)`,
        [tk.order_id, amount, charge ? charge.method : 'CARD', r.providerRef],
      );
    }
    await t.query("UPDATE Tickets SET status = 'REFUNDED' WHERE ticket_id = ?", [ticketId]);
    const live = await t.one(
      "SELECT COUNT(*) AS n FROM Tickets WHERE order_id = ? AND status IN ('VALID','CHECKED_IN')",
      [tk.order_id],
    );
    if (live.n === 0) await t.query("UPDATE Orders SET status = 'REFUNDED' WHERE order_id = ?", [tk.order_id]);
    return { amount, rate: Number(q.refund_rate), days_before_start: q.days_before_start };
  });
}

module.exports = { listMine, getTicket, history, transfer, refund, TICKET_SELECT };
