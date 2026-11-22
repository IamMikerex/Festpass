const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { validate, ah } = require('../utils/validate');
const { authenticate } = require('../middleware/auth');
const { unauthorized, notFound, conflict } = require('../utils/errors');
const orders = require('../services/orders');

const router = express.Router();

/**
 * Payment-gateway webhook (Part 2 a). Idempotent: provider_ref is UNIQUE, so a
 * duplicate delivery is acknowledged without being applied twice (Part 3 d, case 5).
 */
router.post('/webhook', validate(z.object({
  provider_ref: z.string().trim().min(4).max(64),
  order_id: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  method: z.enum(['CARD', 'BANK_TRANSFER', 'WALLET']),
  status: z.enum(['AUTHORIZED', 'CAPTURED', 'FAILED']),
})), ah(async (req, res) => {
  const given = Buffer.from(String(req.headers['x-webhook-secret'] || ''));
  const expected = Buffer.from(config.webhookSecret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw unauthorized('Bad webhook signature');
  const b = req.body;
  const existing = await db.one('SELECT payment_id FROM Payments WHERE provider_ref = ?', [b.provider_ref]);
  if (existing) return res.json({ ok: true, duplicate: true, payment_id: existing.payment_id });
  try {
    const paid = await db.tx(async (t) => {
      const order = await t.one('SELECT * FROM Orders WHERE order_id = ? FOR UPDATE', [b.order_id]);
      if (!order) throw notFound('Order not found');
      if (order.status !== 'PENDING') throw conflict(`Order is ${order.status}`);
      return orders.applyOrderCharge(t, order, { amount: b.amount, method: b.method, providerRef: b.provider_ref, status: b.status });
    });
    return res.json({ ok: true, duplicate: false, order_paid: paid });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.json({ ok: true, duplicate: true });
    throw err;
  }
}));

/** The signed-in user's money trail: ticket orders they bought + stall fees of vendors they manage. */
router.get('/mine', authenticate, ah(async (req, res) => {
  const rows = await db.query(
    `SELECT p.*, 'TICKET_ORDER' AS context, CONCAT('Order #', o.order_id, ' · ', f.name) AS description
       FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
      WHERE o.buyer_id = ?
     UNION ALL
     SELECT p.*, 'STALL_FEE' AS context, CONCAT('Stall ', s.stall_code, ' · ', f.name, ' · ', v.legal_name) AS description
       FROM Payments p JOIN StallAllocations a ON a.allocation_id = p.allocation_id
       JOIN Vendors v ON v.vendor_id = a.vendor_id JOIN Stalls s ON s.stall_id = a.stall_id
       JOIN Festivals f ON f.festival_id = s.festival_id
      WHERE v.manager_id = ?
     ORDER BY processed_at DESC, payment_id DESC`,
    [req.user.user_id, req.user.user_id],
  );
  const sum = (type) => rows.filter((r) => r.payment_type === type && r.status === 'CAPTURED').reduce((s, r) => s + Number(r.amount), 0);
  res.json({ payments: rows, totals: { charged: sum('CHARGE'), refunded: sum('REFUND'), net: sum('CHARGE') - sum('REFUND') } });
}));

module.exports = { router };
