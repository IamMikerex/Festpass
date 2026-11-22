const express = require('express');
const { z } = require('zod');
const { validate, ah } = require('../utils/validate');
const { authenticate } = require('../middleware/auth');
const { badRequest } = require('../utils/errors');
const tickets = require('../services/tickets');

const router = express.Router();
router.use(authenticate);

const uuid = (v) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw badRequest('Invalid ticket id');
  return v;
};

router.get('/', ah(async (req, res) => res.json({ tickets: await tickets.listMine(req.user) })));
router.get('/:id', ah(async (req, res) => res.json({ ticket: await tickets.getTicket(req.user, uuid(req.params.id), { includeQr: true }) })));
router.get('/:id/history', ah(async (req, res) => res.json(await tickets.history(req.user, uuid(req.params.id)))));
router.post('/:id/transfer', validate(z.object({ email: z.string().trim().toLowerCase().email() })), ah(async (req, res) => {
  res.json(await tickets.transfer(req.user, uuid(req.params.id), req.body));
}));
router.post('/:id/refund', ah(async (req, res) => res.json(await tickets.refund(req.user, uuid(req.params.id)))));

module.exports = { router };
