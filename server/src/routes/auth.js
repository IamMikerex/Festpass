const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const { validate, ah } = require('../utils/validate');
const { authenticate, signToken } = require('../middleware/auth');
const { badRequest, unauthorized, conflict } = require('../utils/errors');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts, try again in a few minutes' } });

const password = z.string().min(8, 'Password must be at least 8 characters').max(72)
  .regex(/[A-Za-z]/, 'Password must contain a letter').regex(/[0-9]/, 'Password must contain a number');
const phone = z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Invalid phone number').transform((s) => s.replace(/ /g, ''));
const dob = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => s > '1900-01-01' && new Date(s) < new Date(), 'Invalid date of birth');

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(150),
  password,
  full_name: z.string().trim().min(2).max(100),
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
  date_of_birth: dob,
  // Public sign-up is limited to attendees and vendor managers; staff accounts are created by organizers.
  role: z.enum(['ATTENDEE', 'VENDOR_MANAGER']).default('ATTENDEE'),
});

const publicUser = (u) => ({
  user_id: u.user_id, email: u.email, full_name: u.full_name, phone: u.phone,
  date_of_birth: u.date_of_birth, role: u.role, account_status: u.account_status, created_at: u.created_at,
});

router.post('/register', loginLimiter, validate(registerSchema), ah(async (req, res) => {
  const b = req.body;
  const hash = await bcrypt.hash(b.password, 10);
  const r = await db.query(
    'INSERT INTO Users (email, password_hash, full_name, phone, date_of_birth, role) VALUES (?, ?, ?, ?, ?, ?)',
    [b.email, hash, b.full_name, b.phone || null, b.date_of_birth, b.role],
  );
  const user = await db.one('SELECT * FROM Users WHERE user_id = ?', [r.insertId]);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', loginLimiter, validate(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) })), ah(async (req, res) => {
  const user = await db.one('SELECT * FROM Users WHERE email = ?', [req.body.email]);
  // Same message for unknown email and wrong password: no account enumeration.
  const ok = user && (await bcrypt.compare(req.body.password, user.password_hash));
  if (!ok) throw unauthorized('Incorrect email or password');
  if (user.account_status !== 'ACTIVE') throw unauthorized(`This account is ${user.account_status.toLowerCase()}`);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', authenticate, ah(async (req, res) => {
  const user = await db.one('SELECT * FROM Users WHERE user_id = ?', [req.user.user_id]);
  res.json({ user: publicUser(user) });
}));

router.put('/me', authenticate, validate(z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  phone: phone.nullable().optional().or(z.literal('').transform(() => null)),
})), ah(async (req, res) => {
  const { full_name, phone: ph } = req.body;
  if (full_name === undefined && ph === undefined) throw badRequest('Nothing to update');
  await db.query('UPDATE Users SET full_name = COALESCE(?, full_name), phone = IF(?, ?, phone) WHERE user_id = ?', [
    full_name ?? null, ph !== undefined, ph ?? null, req.user.user_id,
  ]);
  const user = await db.one('SELECT * FROM Users WHERE user_id = ?', [req.user.user_id]);
  res.json({ user: publicUser(user) });
}));

router.put('/password', authenticate, validate(z.object({ current_password: z.string().min(1), new_password: password })), ah(async (req, res) => {
  const user = await db.one('SELECT password_hash FROM Users WHERE user_id = ?', [req.user.user_id]);
  if (!(await bcrypt.compare(req.body.current_password, user.password_hash))) throw conflict('Current password is incorrect');
  await db.query('UPDATE Users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(req.body.new_password, 10), req.user.user_id]);
  res.json({ ok: true });
}));

module.exports = { router, publicUser, password, dob, phone };
