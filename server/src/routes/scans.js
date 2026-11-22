const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate, ah } = require('../utils/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const scans = require('../services/scans');

const router = express.Router();
router.use(authenticate, requireRole('GATE_STAFF'));

router.post('/', validate(z.object({
  qr_token: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, 'Not a FestPass QR code'),
  gate_code: z.string().trim().min(1).max(10).transform((s) => s.toUpperCase()),
  direction: z.enum(['IN', 'OUT']),
  festival_id: z.coerce.number().int().positive().optional(),
})), ah(async (req, res) => res.json(await scans.scan(req.user, req.body))));

router.get('/recent', ah(async (req, res) => res.json({ scans: await scans.recentForStaff(req.user) })));

// Festivals the gate staff can work at: those running today
router.get('/festivals', ah(async (_req, res) => {
  const rows = await db.query(
    `SELECT f.festival_id, f.name, f.city, f.venue_name, f.status, f.start_date, f.end_date,
            (SELECT COUNT(*) FROM v_ticket_last_scan ls JOIN Tickets tk ON tk.ticket_id = ls.ticket_id
               JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = f.festival_id AND ls.direction = 'IN') AS inside_now
       FROM Festivals f WHERE f.status IN ('LIVE','ON_SALE') ORDER BY f.status = 'LIVE' DESC, f.start_date`,
  );
  res.json({ festivals: rows });
}));

module.exports = { router };
