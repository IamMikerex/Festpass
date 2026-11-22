const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db');
const { validate, ah, id } = require('../utils/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { notFound, conflict } = require('../utils/errors');
const { publicUser, password, dob, phone } = require('./auth');

const router = express.Router();
router.use(authenticate, requireRole('ORGANIZER', 'AUDITOR'));

// Dashboards, reports, ledgers, audit trails and CSV exports are served by the
// FastAPI analytics service (see /reports). This router only manages accounts.

// User management (organizers create staff accounts) ----------------------
router.get('/users', ah(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.role) { where.push('role = ?'); params.push(req.query.role); }
  if (req.query.q) { where.push('(full_name LIKE ? OR email LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = await db.query(
    `SELECT user_id, email, full_name, phone, date_of_birth, role, account_status, created_at FROM Users
      WHERE ${where.join(' AND ')} ORDER BY FIELD(role,'ORGANIZER','GATE_STAFF','AUDITOR','VENDOR_MANAGER','ATTENDEE'), full_name LIMIT 500`,
    params,
  );
  res.json({ users: rows });
}));

router.post('/users', requireRole('ORGANIZER'), validate(z.object({
  email: z.string().trim().toLowerCase().email().max(150),
  password,
  full_name: z.string().trim().min(2).max(100),
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
  date_of_birth: dob,
  role: z.enum(['ORGANIZER', 'GATE_STAFF', 'AUDITOR', 'VENDOR_MANAGER', 'ATTENDEE']),
})), ah(async (req, res) => {
  const b = req.body;
  const r = await db.query(
    'INSERT INTO Users (email, password_hash, full_name, phone, date_of_birth, role) VALUES (?, ?, ?, ?, ?, ?)',
    [b.email, await bcrypt.hash(b.password, 10), b.full_name, b.phone || null, b.date_of_birth, b.role],
  );
  res.status(201).json({ user: publicUser(await db.one('SELECT * FROM Users WHERE user_id = ?', [r.insertId])) });
}));

router.patch('/users/:id/status', requireRole('ORGANIZER'),
  validate(z.object({ account_status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']) })), ah(async (req, res) => {
    const uid = id(req.params.id);
    if (uid === req.user.user_id) throw conflict('You cannot change your own account status');
    const u = await db.one('SELECT * FROM Users WHERE user_id = ?', [uid]);
    if (!u) throw notFound('User not found');
    if (u.account_status === 'DELETED') throw conflict('Deleted accounts cannot be reactivated');
    // Users are never hard-deleted (financial history); DELETED anonymises personal fields (KVKK).
    if (req.body.account_status === 'DELETED') {
      await db.query(
        `UPDATE Users SET account_status = 'DELETED', email = CONCAT('deleted-', user_id, '@festpass.invalid'),
                full_name = 'Deleted user', phone = NULL WHERE user_id = ?`,
        [uid],
      );
    } else {
      await db.query('UPDATE Users SET account_status = ? WHERE user_id = ?', [req.body.account_status, uid]);
    }
    res.json({ ok: true });
  }));

module.exports = { router };
