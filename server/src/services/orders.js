const db = require('../db');
const gateway = require('./gateway');
const { badRequest, conflict, forbidden, notFound, HttpError } = require('../utils/errors');

const MAX_PER_FESTIVAL = 10; // rule 1
const HOLD_MINUTES = 10;     // rule 3

/**
 * Creates a PENDING order with a 10-minute hold (rule 3).
 * Concurrency: tier rows are locked with SELECT ... FOR UPDATE (Part 3 d, case 1),
 * in ascending id order so two multi-tier checkouts cannot deadlock.
 */
async function createOrder(buyer, { festival_id, items }) {
  if (!items.length) throw badRequest('Choose at least one ticket');
  const merged = new Map();
  for (const it of items) {
    const cur = merged.get(it.tier_id) || { tier_id: it.tier_id, quantity: 0, holder_emails: [] };
    cur.quantity += it.quantity;
    cur.holder_emails.push(...(it.holder_emails || []));
    merged.set(it.tier_id, cur);
  }
  const lines = [...merged.values()].sort((a, b) => a.tier_id - b.tier_id);
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  return db.tx(async (t) => {
    const fest = await t.one('SELECT * FROM Festivals WHERE festival_id = ? FOR SHARE', [festival_id]);
    if (!fest) throw notFound('Festival not found');
    if (fest.status !== 'ON_SALE') throw conflict('Tickets can only be bought while the festival is ON_SALE (rule 12)');

    const tiers = await t.query(
      `SELECT tier_id, festival_id, tier_name, price, quota, max_per_order,
              (NOW() BETWEEN sale_start AND sale_end) AS in_window
         FROM TicketTiers WHERE tier_id IN (?) ORDER BY tier_id FOR UPDATE`,
      [lines.map((l) => l.tier_id)],
    );
    if (tiers.length !== lines.length) throw notFound('Ticket tier not found');

    // Rule 1: at most 10 tickets per buyer per festival across PAID + PENDING orders
    const held = await t.one(
      `SELECT COUNT(*) AS n FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
        WHERE o.buyer_id = ? AND o.festival_id = ? AND o.status IN ('PENDING','PAID')
          AND tk.status IN ('VALID','CHECKED_IN')`,
      [buyer.user_id, festival_id],
    );
    if (held.n + totalQty > MAX_PER_FESTIVAL) {
      throw conflict(`You can hold at most ${MAX_PER_FESTIVAL} tickets for this festival; you already have ${held.n} (rule 1)`);
    }

    for (const line of lines) {
      const tier = tiers.find((x) => x.tier_id === line.tier_id);
      if (tier.festival_id !== fest.festival_id) throw badRequest('Tier does not belong to this festival');
      if (!tier.in_window) throw conflict(`${tier.tier_name} is not on sale right now`);
      if (line.quantity > tier.max_per_order) {
        throw conflict(`At most ${tier.max_per_order} ${tier.tier_name} tickets per order (rule 1)`);
      }
      const used = await t.one(
        "SELECT COUNT(*) AS n FROM Tickets WHERE tier_id = ? AND status IN ('VALID','CHECKED_IN')",
        [tier.tier_id],
      );
      if (used.n + line.quantity > tier.quota) {
        const left = Math.max(0, tier.quota - used.n);
        throw conflict(left ? `Only ${left} ${tier.tier_name} tickets left` : `${tier.tier_name} is sold out`);
      }
      line.tier = tier;
    }

    // Resolve named holders (rule 4). Empty slots default to the buyer.
    const emails = [...new Set(lines.flatMap((l) => l.holder_emails).filter(Boolean).map((e) => e.toLowerCase()))];
    const holders = new Map();
    if (emails.length) {
      const users = await t.query(
        `SELECT user_id, email, full_name, account_status,
                TIMESTAMPDIFF(YEAR, date_of_birth, ?) AS age_at_start
           FROM Users WHERE email IN (?)`,
        [fest.start_date, emails],
      );
      for (const u of users) holders.set(u.email.toLowerCase(), u);
      for (const e of emails) {
        const u = holders.get(e);
        if (!u || u.account_status !== 'ACTIVE') throw badRequest(`${e} is not a registered FestPass user`);
        if (u.age_at_start < fest.min_age) {
          throw conflict(`${u.full_name} will be under ${fest.min_age} on the festival start date (rule 4)`);
        }
      }
    }
    const buyerAge = await t.one('SELECT TIMESTAMPDIFF(YEAR, date_of_birth, ?) AS age FROM Users WHERE user_id = ?', [
      fest.start_date, buyer.user_id,
    ]);

    const res = await t.query(
      `INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at)
       VALUES (?, ?, 'PENDING', NOW(), NOW() + INTERVAL ${HOLD_MINUTES} MINUTE)`,
      [buyer.user_id, festival_id],
    );
    const orderId = res.insertId;

    for (const line of lines) {
      for (let i = 0; i < line.quantity; i += 1) {
        const email = line.holder_emails[i] ? line.holder_emails[i].toLowerCase() : null;
        const holderId = email ? holders.get(email).user_id : buyer.user_id;
        if (!email && buyerAge.age < fest.min_age) {
          throw conflict(`You will be under ${fest.min_age} on the festival start date (rule 4). Assign the ticket to an eligible holder.`);
        }
        await t.query(
          'INSERT INTO Tickets (ticket_id, order_id, tier_id, holder_id, qr_token) VALUES (UUID(), ?, ?, ?, ?)',
          [orderId, line.tier_id, holderId, gateway.newQrToken()],
        );
      }
    }

    const totals = await t.one('SELECT total_amount FROM v_order_totals WHERE order_id = ?', [orderId]);
    if (Number(totals.total_amount) === 0) {
      // Free tickets need no payment row (amount > 0 CHECK); confirm immediately.
      await t.query("UPDATE Orders SET status = 'PAID', paid_at = NOW() WHERE order_id = ?", [orderId]);
    }
    return orderId;
  });
}

async function getOrder(orderId) {
  const order = await db.one(
    `SELECT ot.*, f.name AS festival_name, f.city, f.venue_name, f.start_date, f.end_date,
            GREATEST(TIMESTAMPDIFF(SECOND, NOW(), ot.expires_at), 0) AS seconds_left
       FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id
      WHERE ot.order_id = ?`,
    [orderId],
  );
  if (!order) return null;
  order.tickets = await db.query(
    `SELECT tk.ticket_id, tk.status, tk.issued_at, t.tier_name, t.price, u.full_name AS holder_name, u.email AS holder_email
       FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Users u ON u.user_id = tk.holder_id
      WHERE tk.order_id = ? ORDER BY t.tier_name, tk.issued_at`,
    [orderId],
  );
  order.payments = await db.query('SELECT * FROM Payments WHERE order_id = ? ORDER BY processed_at, payment_id', [orderId]);
  return order;
}

/** Expires one locked PENDING order (rule 3): order EXPIRED, tickets VOID, quota freed. */
async function expireLocked(t, orderId) {
  await t.query("UPDATE Tickets SET status = 'VOID' WHERE order_id = ? AND status = 'VALID'", [orderId]);
  await t.query("UPDATE Orders SET status = 'EXPIRED' WHERE order_id = ? AND status = 'PENDING'", [orderId]);
}

/**
 * Records a captured CHARGE for a locked order and marks it PAID when fully covered.
 * Shared by checkout and the gateway webhook. Duplicate provider_ref is rejected by UNIQUE (case 5).
 */
async function applyOrderCharge(t, order, { amount, method, providerRef, status }) {
  await t.query(
    `INSERT INTO Payments (order_id, payment_type, amount, currency, method, status, provider_ref)
     VALUES (?, 'CHARGE', ?, 'TRY', ?, ?, ?)`,
    [order.order_id, amount, method, status, providerRef],
  );
  if (status !== 'CAPTURED') return false;
  const tot = await t.one('SELECT total_amount, captured_amount FROM v_order_totals WHERE order_id = ?', [order.order_id]);
  if (Number(tot.captured_amount) + 0.001 >= Number(tot.total_amount)) {
    await t.query("UPDATE Orders SET status = 'PAID', paid_at = NOW() WHERE order_id = ? AND status = 'PENDING'", [order.order_id]);
    return true;
  }
  return false;
}

async function payOrder(user, orderId, { method, card_number }) {
  const outcome = await db.tx(async (t) => {
    const order = await t.one(
      'SELECT o.*, (o.expires_at < NOW()) AS is_expired FROM Orders o WHERE o.order_id = ? FOR UPDATE',
      [orderId],
    );
    if (!order) throw notFound('Order not found');
    if (order.buyer_id !== user.user_id) throw forbidden();
    if (order.status !== 'PENDING') throw conflict(`This order is already ${order.status}`);
    if (order.is_expired) {
      await expireLocked(t, orderId);
      return { expired: true };
    }
    const tot = await t.one('SELECT total_amount, captured_amount FROM v_order_totals WHERE order_id = ?', [orderId]);
    const due = Math.round((Number(tot.total_amount) - Number(tot.captured_amount)) * 100) / 100;
    const g = gateway.charge({ method, cardNumber: card_number });
    const paid = await applyOrderCharge(t, order, { amount: due, method, providerRef: g.providerRef, status: g.status });
    return { paid, declineReason: g.declineReason, providerRef: g.providerRef };
  });
  if (outcome.expired) throw new HttpError(410, 'Your 10-minute checkout hold expired and the tickets were released (rule 3)');
  if (!outcome.paid) throw new HttpError(402, outcome.declineReason || 'Payment failed');
  return outcome;
}

async function cancelPendingOrder(user, orderId) {
  return db.tx(async (t) => {
    const order = await t.one('SELECT * FROM Orders WHERE order_id = ? FOR UPDATE', [orderId]);
    if (!order) throw notFound('Order not found');
    if (order.buyer_id !== user.user_id) throw forbidden();
    if (order.status !== 'PENDING') throw conflict('Only pending orders can be cancelled; use a refund for paid tickets');
    await t.query("UPDATE Tickets SET status = 'VOID' WHERE order_id = ? AND status = 'VALID'", [orderId]);
    await t.query("UPDATE Orders SET status = 'CANCELLED' WHERE order_id = ?", [orderId]);
  });
}

/** Scheduled job (rule 3). SKIP LOCKED leaves orders that are mid-checkout alone. */
async function expireStaleOrders() {
  return db.tx(async (t) => {
    const rows = await t.query(
      "SELECT order_id FROM Orders WHERE status = 'PENDING' AND expires_at < NOW() FOR UPDATE SKIP LOCKED",
    );
    for (const r of rows) await expireLocked(t, r.order_id);
    return rows.length;
  });
}

module.exports = { createOrder, getOrder, payOrder, cancelPendingOrder, expireStaleOrders, applyOrderCharge, expireLocked };
