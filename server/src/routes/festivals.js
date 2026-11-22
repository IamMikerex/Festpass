const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate, ah, id } = require('../utils/validate');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { notFound, conflict, forbidden } = require('../utils/errors');
const fest = require('../services/festivals');
const vendors = require('../services/vendors');

const router = express.Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const datetime = z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Use YYYY-MM-DD HH:MM').transform((s) => s.replace('T', ' '));
const money = z.coerce.number().min(0).max(99999999.99).transform((n) => Math.round(n * 100) / 100);

const festivalSchema = z.object({
  name: z.string().trim().min(3).max(120),
  venue_name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(60),
  start_date: date,
  end_date: date,
  daily_capacity: z.coerce.number().int().positive().max(1000000),
  min_age: z.coerce.number().int().min(0).max(21).default(16),
}).refine((f) => f.end_date >= f.start_date, { message: 'End date must be on or after the start date', path: ['end_date'] });

const tierSchema = z.object({
  tier_name: z.string().trim().min(2).max(60),
  price: money,
  quota: z.coerce.number().int().positive(),
  max_per_order: z.coerce.number().int().min(1).max(10).default(6),
  sale_start: datetime,
  sale_end: datetime,
});

const stallSchema = z.object({
  stall_code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only').transform((s) => s.toUpperCase()),
  zone: z.enum(['FOOD_COURT', 'MAIN_STAGE', 'CAMPING', 'ENTRANCE']),
  size_m2: z.coerce.number().positive().max(999.99),
  has_power: z.coerce.boolean().default(false),
  base_fee: money,
});

const LIST_SELECT = `
  SELECT f.*, u.full_name AS organizer_name,
         (SELECT MIN(price) FROM TicketTiers t WHERE t.festival_id = f.festival_id) AS min_price,
         (SELECT COALESCE(SUM(remaining), 0) FROM v_tier_availability a WHERE a.festival_id = f.festival_id) AS tickets_remaining,
         (SELECT COALESCE(SUM(quota), 0) FROM TicketTiers t WHERE t.festival_id = f.festival_id) AS total_quota,
         (SELECT COUNT(*) FROM Stalls s WHERE s.festival_id = f.festival_id) AS stall_count,
         DATEDIFF(f.start_date, CURDATE()) AS days_until
    FROM Festivals f JOIN Users u ON u.user_id = f.organizer_id`;

// Public catalogue -------------------------------------------------------
router.get('/', ah(async (req, res) => {
  const { q, city, status } = req.query;
  const where = [];
  const params = [];
  const allowed = ['ON_SALE', 'LIVE', 'COMPLETED', 'CANCELLED'];
  if (status && allowed.includes(status)) { where.push('f.status = ?'); params.push(status); } else where.push("f.status IN ('ON_SALE','LIVE')");
  if (q) { where.push('(f.name LIKE ? OR f.venue_name LIKE ? OR f.city LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (city) { where.push('f.city = ?'); params.push(city); }
  const rows = await db.query(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.start_date`, params);
  const cities = await db.query("SELECT DISTINCT city FROM Festivals WHERE status IN ('ON_SALE','LIVE') ORDER BY city");
  res.json({ festivals: rows, cities: cities.map((c) => c.city) });
}));

router.get('/mine', authenticate, requireRole('ORGANIZER', 'AUDITOR'), ah(async (req, res) => {
  const where = req.user.role === 'ORGANIZER' ? 'WHERE f.organizer_id = ?' : '';
  const rows = await db.query(
    `SELECT s.*, f.venue_name, f.city, f.min_age FROM v_festival_stats s JOIN Festivals f ON f.festival_id = s.festival_id
     ${where} ORDER BY FIELD(s.status,'LIVE','ON_SALE','DRAFT','COMPLETED','CANCELLED'), s.start_date`,
    [req.user.user_id],
  );
  res.json({ festivals: rows });
}));

router.get('/:id', optionalAuth, ah(async (req, res) => {
  const f = await db.one(`${LIST_SELECT} WHERE f.festival_id = ?`, [id(req.params.id)]);
  if (!f) throw notFound('Festival not found');
  const canSeeDraft = req.user && (req.user.role === 'AUDITOR' || req.user.user_id === f.organizer_id);
  if (f.status === 'DRAFT' && !canSeeDraft) throw notFound('Festival not found');
  const tiers = await db.query(
    `SELECT a.*, (NOW() BETWEEN a.sale_start AND a.sale_end) AS on_sale_now, (NOW() < a.sale_start) AS sale_not_started
       FROM v_tier_availability a WHERE a.festival_id = ? ORDER BY a.price`,
    [f.festival_id],
  );
  res.json({ festival: f, tiers, next_statuses: fest.NEXT[f.status] });
}));

// Organizer management --------------------------------------------------
router.post('/', authenticate, requireRole('ORGANIZER'), validate(festivalSchema), ah(async (req, res) => {
  const b = req.body;
  const r = await db.query(
    `INSERT INTO Festivals (organizer_id, name, venue_name, city, start_date, end_date, daily_capacity, min_age)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.user_id, b.name, b.venue_name, b.city, b.start_date, b.end_date, b.daily_capacity, b.min_age],
  );
  res.status(201).json({ festival_id: r.insertId });
}));

router.put('/:id', authenticate, requireRole('ORGANIZER'), validate(festivalSchema), ah(async (req, res) => {
  const fid = id(req.params.id);
  const f = await fest.loadOwned(db, req.user, fid);
  const b = req.body;
  const changed = {
    start_date: b.start_date !== f.start_date ? b.start_date : undefined,
    end_date: b.end_date !== f.end_date ? b.end_date : undefined,
    min_age: b.min_age !== f.min_age ? b.min_age : undefined,
  };
  await fest.assertEditable(f, changed);
  await db.query(
    `UPDATE Festivals SET name = ?, venue_name = ?, city = ?, start_date = ?, end_date = ?, daily_capacity = ?, min_age = ?
      WHERE festival_id = ?`,
    [b.name, b.venue_name, b.city, b.start_date, b.end_date, b.daily_capacity, b.min_age, fid],
  );
  res.json({ ok: true });
}));

router.post('/:id/status', authenticate, requireRole('ORGANIZER'),
  validate(z.object({ status: z.enum(['ON_SALE', 'LIVE', 'COMPLETED', 'CANCELLED']) })),
  ah(async (req, res) => res.json(await fest.changeStatus(req.user, id(req.params.id), req.body.status))));

router.delete('/:id', authenticate, requireRole('ORGANIZER'), ah(async (req, res) => {
  const fid = id(req.params.id);
  const f = await fest.loadOwned(db, req.user, fid);
  if (f.status !== 'DRAFT') throw conflict('Only DRAFT festivals can be deleted; cancel it instead');
  await db.tx(async (t) => {
    await t.query('DELETE FROM TicketTiers WHERE festival_id = ?', [fid]);
    await t.query('DELETE FROM Festivals WHERE festival_id = ?', [fid]);
  });
  res.json({ ok: true });
}));

// Ticket tiers ----------------------------------------------------------
router.post('/:id/tiers', authenticate, requireRole('ORGANIZER'), validate(tierSchema), ah(async (req, res) => {
  const fid = id(req.params.id);
  const f = await fest.loadOwned(db, req.user, fid);
  if (['COMPLETED', 'CANCELLED', 'LIVE'].includes(f.status)) throw conflict(`Cannot add tiers to a ${f.status} festival`);
  fest.validateTierWindow(req.body, f);
  const b = req.body;
  const r = await db.query(
    'INSERT INTO TicketTiers (festival_id, tier_name, price, quota, max_per_order, sale_start, sale_end) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [fid, b.tier_name, b.price, b.quota, b.max_per_order, b.sale_start, b.sale_end],
  );
  res.status(201).json({ tier_id: r.insertId });
}));

router.put('/:id/tiers/:tierId', authenticate, requireRole('ORGANIZER'), validate(tierSchema), ah(async (req, res) => {
  const fid = id(req.params.id);
  const f = await fest.loadOwned(db, req.user, fid);
  if (['COMPLETED', 'CANCELLED'].includes(f.status)) throw conflict(`Cannot edit tiers of a ${f.status} festival`);
  fest.validateTierWindow(req.body, f);
  const b = req.body;
  const r = await db.query(
    `UPDATE TicketTiers SET tier_name = ?, price = ?, quota = ?, max_per_order = ?, sale_start = ?, sale_end = ?
      WHERE tier_id = ? AND festival_id = ?`,
    [b.tier_name, b.price, b.quota, b.max_per_order, b.sale_start, b.sale_end, id(req.params.tierId), fid],
  );
  if (!r.affectedRows) throw notFound('Tier not found');
  res.json({ ok: true });
}));

router.delete('/:id/tiers/:tierId', authenticate, requireRole('ORGANIZER'), ah(async (req, res) => {
  const fid = id(req.params.id);
  await fest.loadOwned(db, req.user, fid);
  const tid = id(req.params.tierId);
  const used = await db.one('SELECT COUNT(*) AS n FROM Tickets WHERE tier_id = ?', [tid]);
  if (used.n) throw conflict('Tiers with issued tickets cannot be deleted');
  await db.query('DELETE FROM TicketTiers WHERE tier_id = ? AND festival_id = ?', [tid, fid]);
  res.json({ ok: true });
}));

// Stalls (site map) -----------------------------------------------------
router.get('/:id/stalls', authenticate, ah(async (req, res) => {
  const fid = id(req.params.id);
  const f = await db.one('SELECT * FROM Festivals WHERE festival_id = ?', [fid]);
  if (!f) throw notFound('Festival not found');
  const staff = req.user.role === 'AUDITOR' || (req.user.role === 'ORGANIZER' && f.organizer_id === req.user.user_id);
  if (f.status === 'DRAFT' && !staff) throw notFound('Festival not found');
  const stalls = await db.query(
    `SELECT s.*, a.allocation_id AS approved_allocation_id, v.legal_name AS approved_vendor, v.manager_id AS approved_manager_id,
            (SELECT COUNT(*) FROM StallAllocations x WHERE x.stall_id = s.stall_id AND x.status = 'APPLIED') AS open_applications
       FROM Stalls s
       LEFT JOIN StallAllocations a ON a.stall_id = s.stall_id AND a.status = 'APPROVED'
       LEFT JOIN Vendors v ON v.vendor_id = a.vendor_id
      WHERE s.festival_id = ? ORDER BY FIELD(s.zone,'FOOD_COURT','MAIN_STAGE','CAMPING','ENTRANCE'), s.stall_code`,
    [fid],
  );
  // Non-staff only learn whether a stall is taken, and by whom only if it is their own vendor.
  const out = stalls.map((s) => (staff || s.approved_manager_id === req.user.user_id
    ? s : { ...s, approved_vendor: s.approved_vendor ? 'Allocated' : null, approved_allocation_id: null }));
  let eligibility = null;
  if (req.user.role === 'VENDOR_MANAGER') {
    const mine = await db.query('SELECT * FROM Vendors WHERE manager_id = ?', [req.user.user_id]);
    eligibility = mine.map((v) => ({ vendor_id: v.vendor_id, legal_name: v.legal_name, ...vendors.eligibility(v, f) }));
  }
  res.json({ festival: f, stalls: out.map(({ approved_manager_id, ...s }) => s), eligibility });
}));

router.post('/:id/stalls', authenticate, requireRole('ORGANIZER'), validate(stallSchema), ah(async (req, res) => {
  const fid = id(req.params.id);
  const f = await fest.loadOwned(db, req.user, fid);
  if (['COMPLETED', 'CANCELLED'].includes(f.status)) throw conflict(`Cannot add stalls to a ${f.status} festival`);
  const b = req.body;
  const r = await db.query(
    'INSERT INTO Stalls (festival_id, stall_code, zone, size_m2, has_power, base_fee) VALUES (?, ?, ?, ?, ?, ?)',
    [fid, b.stall_code, b.zone, b.size_m2, b.has_power, b.base_fee],
  );
  res.status(201).json({ stall_id: r.insertId });
}));

router.put('/:id/stalls/:stallId', authenticate, requireRole('ORGANIZER'), validate(stallSchema), ah(async (req, res) => {
  const fid = id(req.params.id);
  await fest.loadOwned(db, req.user, fid);
  const b = req.body;
  const r = await db.query(
    'UPDATE Stalls SET stall_code = ?, zone = ?, size_m2 = ?, has_power = ?, base_fee = ? WHERE stall_id = ? AND festival_id = ?',
    [b.stall_code, b.zone, b.size_m2, b.has_power, b.base_fee, id(req.params.stallId), fid],
  );
  if (!r.affectedRows) throw notFound('Stall not found');
  res.json({ ok: true });
}));

router.delete('/:id/stalls/:stallId', authenticate, requireRole('ORGANIZER'), ah(async (req, res) => {
  const fid = id(req.params.id);
  await fest.loadOwned(db, req.user, fid);
  const sid = id(req.params.stallId);
  const used = await db.one('SELECT COUNT(*) AS n FROM StallAllocations WHERE stall_id = ?', [sid]);
  if (used.n) throw conflict('Stalls with applications cannot be deleted');
  await db.query('DELETE FROM Stalls WHERE stall_id = ? AND festival_id = ?', [sid, fid]);
  res.json({ ok: true });
}));

// Stall applications for one festival (organizer review queue)
router.get('/:id/allocations', authenticate, requireRole('ORGANIZER', 'AUDITOR'), ah(async (req, res) => {
  const fid = id(req.params.id);
  const f = await db.one('SELECT organizer_id FROM Festivals WHERE festival_id = ?', [fid]);
  if (!f) throw notFound('Festival not found');
  if (req.user.role === 'ORGANIZER' && f.organizer_id !== req.user.user_id) throw forbidden();
  const rows = await db.query(
    `${vendors.ALLOC_SELECT} WHERE f.festival_id = ? ORDER BY FIELD(a.status,'APPLIED','APPROVED','REJECTED','CANCELLED'), a.applied_at DESC`,
    [fid],
  );
  res.json({ allocations: rows });
}));

module.exports = { router };
