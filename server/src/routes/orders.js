const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate, ah, id } = require('../utils/validate');
const { authenticate } = require('../middleware/auth');
const { notFound, forbidden } = require('../utils/errors');
const orders = require('../services/orders');

const router = express.Router();
router.use(authenticate);

const orderSchema = z.object({
  festival_id: z.coerce.number().int().positive(),
  items: z.array(z.object({
    tier_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(10),
    holder_emails: z.array(z.string().trim().toLowerCase().email().or(z.literal(''))).max(10).optional(),
  })).min(1).max(10),
});

const paySchema = z.object({
  method: z.enum(['CARD', 'BANK_TRANSFER', 'WALLET']),
  card_number: z.string().trim().max(23).optional(),
}).refine((p) => p.method !== 'CARD' || (p.card_number && p.card_number.replace(/\D/g, '').length >= 12),
  { message: 'Enter a card number', path: ['card_number'] });

router.post('/', validate(orderSchema), ah(async (req, res) => {
  const orderId = await orders.createOrder(req.user, req.body);
  res.status(201).json({ order: await orders.getOrder(orderId) });
}));

router.get('/', ah(async (req, res) => {
  const rows = await db.query(
    `SELECT ot.*, f.name AS festival_name, f.start_date, f.city,
            GREATEST(TIMESTAMPDIFF(SECOND, NOW(), ot.expires_at), 0) AS seconds_left
       FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id
      WHERE ot.buyer_id = ? ORDER BY ot.created_at DESC`,
    [req.user.user_id],
  );
  res.json({ orders: rows });
}));

router.get('/:id', ah(async (req, res) => {
  const order = await orders.getOrder(id(req.params.id));
  if (!order) throw notFound('Order not found');
  if (order.buyer_id !== req.user.user_id && req.user.role !== 'AUDITOR') {
    const f = await db.one('SELECT organizer_id FROM Festivals WHERE festival_id = ?', [order.festival_id]);
    if (!(req.user.role === 'ORGANIZER' && f.organizer_id === req.user.user_id)) throw forbidden();
  }
  res.json({ order });
}));

router.post('/:id/pay', validate(paySchema), ah(async (req, res) => {
  const result = await orders.payOrder(req.user, id(req.params.id), req.body);
  res.json({ ...result, order: await orders.getOrder(id(req.params.id)) });
}));

router.post('/:id/cancel', ah(async (req, res) => {
  await orders.cancelPendingOrder(req.user, id(req.params.id));
  res.json({ ok: true });
}));

module.exports = { router, paySchema };
