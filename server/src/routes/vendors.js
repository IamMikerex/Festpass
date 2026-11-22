const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate, ah, id } = require('../utils/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { notFound, forbidden, conflict } = require('../utils/errors');
const vendors = require('../services/vendors');
const { paySchema } = require('./orders');

const router = express.Router();
router.use(authenticate);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const vendorSchema = z.object({
  legal_name: z.string().trim().min(2).max(150),
  tax_number: z.string().trim().regex(/^[0-9]{10}$/, 'Tax number (VKN) must be exactly 10 digits'),
  category: z.enum(['FOOD', 'BEVERAGE', 'MERCH', 'SERVICE']),
  license_expiry: date,
  hygiene_cert_expiry: date.nullable().optional().or(z.literal('').transform(() => null)),
}).refine((v) => !['FOOD', 'BEVERAGE'].includes(v.category) || v.hygiene_cert_expiry,
  { message: 'Food and beverage vendors must provide a hygiene certificate expiry date', path: ['hygiene_cert_expiry'] });

// Vendor manager: own businesses -----------------------------------------
router.get('/mine', requireRole('VENDOR_MANAGER'), ah(async (req, res) => {
  const rows = await db.query(
    `SELECT v.*,
            (SELECT COUNT(*) FROM StallAllocations a WHERE a.vendor_id = v.vendor_id AND a.status = 'APPROVED') AS approved_stalls,
            (SELECT COUNT(*) FROM StallAllocations a WHERE a.vendor_id = v.vendor_id AND a.status = 'APPLIED') AS open_applications
       FROM Vendors v WHERE v.manager_id = ? ORDER BY v.legal_name`,
    [req.user.user_id],
  );
  res.json({ vendors: rows });
}));

router.post('/', requireRole('VENDOR_MANAGER'), validate(vendorSchema), ah(async (req, res) => {
  const b = req.body;
  const r = await db.query(
    'INSERT INTO Vendors (manager_id, legal_name, tax_number, category, license_expiry, hygiene_cert_expiry) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.user_id, b.legal_name, b.tax_number, b.category, b.license_expiry, b.hygiene_cert_expiry || null],
  );
  res.status(201).json({ vendor_id: r.insertId });
}));

router.put('/:id', requireRole('VENDOR_MANAGER'), validate(vendorSchema), ah(async (req, res) => {
  const vid = id(req.params.id);
  const v = await db.one('SELECT * FROM Vendors WHERE vendor_id = ?', [vid]);
  if (!v) throw notFound('Vendor not found');
  if (v.manager_id !== req.user.user_id) throw forbidden();
  if (v.status === 'BLACKLISTED') throw conflict('Blacklisted vendors cannot be edited');
  const b = req.body;
  if (b.tax_number !== v.tax_number || b.category !== v.category) {
    const used = await db.one('SELECT COUNT(*) AS n FROM StallAllocations WHERE vendor_id = ?', [vid]);
    if (used.n) throw conflict('Tax number and category are locked once the vendor has applied for stalls');
  }
  await db.query(
    'UPDATE Vendors SET legal_name = ?, tax_number = ?, category = ?, license_expiry = ?, hygiene_cert_expiry = ? WHERE vendor_id = ?',
    [b.legal_name, b.tax_number, b.category, b.license_expiry, b.hygiene_cert_expiry || null, vid],
  );
  res.json({ ok: true });
}));

// Organizer / auditor: registry and review --------------------------------
router.get('/', requireRole('ORGANIZER', 'AUDITOR'), ah(async (req, res) => {
  const { status, q } = req.query;
  const where = ['1=1'];
  const params = [];
  if (status) { where.push('v.status = ?'); params.push(status); }
  if (q) { where.push('(v.legal_name LIKE ? OR v.tax_number LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const rows = await db.query(
    `SELECT v.*, u.full_name AS manager_name, u.email AS manager_email,
            (v.license_expiry < CURDATE()) AS license_expired,
            (v.hygiene_cert_expiry IS NOT NULL AND v.hygiene_cert_expiry < CURDATE()) AS hygiene_expired,
            (SELECT COUNT(*) FROM StallAllocations a WHERE a.vendor_id = v.vendor_id AND a.status = 'APPROVED') AS approved_stalls
       FROM Vendors v JOIN Users u ON u.user_id = v.manager_id
      WHERE ${where.join(' AND ')}
      ORDER BY FIELD(v.status,'PENDING_REVIEW','ACTIVE','BLACKLISTED'), v.legal_name`,
    params,
  );
  res.json({ vendors: rows });
}));

router.post('/:id/status', requireRole('ORGANIZER'),
  validate(z.object({ status: z.enum(['ACTIVE', 'BLACKLISTED', 'PENDING_REVIEW']) })), ah(async (req, res) => {
    const vid = id(req.params.id);
    await db.tx(async (t) => {
      const v = await t.one('SELECT * FROM Vendors WHERE vendor_id = ? FOR UPDATE', [vid]);
      if (!v) throw notFound('Vendor not found');
      await t.query('UPDATE Vendors SET status = ? WHERE vendor_id = ?', [req.body.status, vid]);
      if (req.body.status === 'BLACKLISTED') {
        // Open applications from a blacklisted vendor are rejected.
        await t.query("UPDATE StallAllocations SET status = 'REJECTED', reviewed_by = ? WHERE vendor_id = ? AND status = 'APPLIED'", [req.user.user_id, vid]);
      }
    });
    res.json({ ok: true });
  }));

// Stall applications (allocations) ---------------------------------------
const alloc = express.Router();
alloc.use(authenticate);

alloc.get('/mine', requireRole('VENDOR_MANAGER'), ah(async (req, res) => {
  const rows = await db.query(`${vendors.ALLOC_SELECT} WHERE v.manager_id = ? ORDER BY a.applied_at DESC`, [req.user.user_id]);
  res.json({ allocations: rows });
}));

alloc.get('/pending', requireRole('ORGANIZER'), ah(async (req, res) => {
  const rows = await db.query(
    `${vendors.ALLOC_SELECT} WHERE f.organizer_id = ? AND a.status = 'APPLIED' ORDER BY a.applied_at`,
    [req.user.user_id],
  );
  res.json({ allocations: rows.map((a) => ({ ...a, ...vendors.eligibility({
    status: a.vendor_status, license_expiry: a.license_expiry, hygiene_cert_expiry: a.hygiene_cert_expiry, category: a.category,
  }, a) })) });
}));

alloc.post('/', requireRole('VENDOR_MANAGER'), validate(z.object({
  vendor_id: z.coerce.number().int().positive(), stall_id: z.coerce.number().int().positive(),
})), ah(async (req, res) => {
  const allocationId = await vendors.apply(req.user, req.body);
  res.status(201).json({ allocation: await vendors.getAllocation(allocationId) });
}));

alloc.post('/:id/approve', requireRole('ORGANIZER'), validate(z.object({
  agreed_fee: z.coerce.number().min(0).max(99999999.99).optional(),
})), ah(async (req, res) => {
  await vendors.approve(req.user, id(req.params.id), req.body);
  res.json({ allocation: await vendors.getAllocation(id(req.params.id)) });
}));

alloc.post('/:id/reject', requireRole('ORGANIZER'), ah(async (req, res) => {
  await vendors.reject(req.user, id(req.params.id));
  res.json({ ok: true });
}));

alloc.post('/:id/cancel', requireRole('ORGANIZER', 'VENDOR_MANAGER'), ah(async (req, res) => {
  res.json(await vendors.cancel(req.user, id(req.params.id)));
}));

alloc.post('/:id/pay', requireRole('VENDOR_MANAGER'), validate(paySchema), ah(async (req, res) => {
  res.json(await vendors.pay(req.user, id(req.params.id), req.body));
}));

module.exports = { router, allocRouter: alloc };
