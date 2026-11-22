const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db');
const { validate, ah, id, toCsv } = require('../utils/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { notFound, forbidden, conflict } = require('../utils/errors');
const { publicUser, password, dob, phone } = require('./auth');

const router = express.Router();
router.use(authenticate, requireRole('ORGANIZER', 'AUDITOR'));

/** Organizers see their own festivals; auditors (read-only) see everything. */
const scope = (user, alias = 'f') => (user.role === 'AUDITOR'
  ? { sql: '1=1', params: [] }
  : { sql: `${alias}.organizer_id = ?`, params: [user.user_id] });

async function assertFestivalAccess(user, festivalId) {
  const f = await db.one('SELECT * FROM Festivals WHERE festival_id = ?', [festivalId]);
  if (!f) throw notFound('Festival not found');
  if (user.role === 'ORGANIZER' && f.organizer_id !== user.user_id) throw forbidden();
  return f;
}

const sendMaybeCsv = (req, res, rows, name, key) => {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(toCsv(rows));
  }
  return res.json({ [key]: rows });
};

// Dashboard ---------------------------------------------------------------
router.get('/dashboard', ah(async (req, res) => {
  const s = scope(req.user, 's');
  const festivals = await db.query(`SELECT * FROM v_festival_stats s WHERE ${s.sql} ORDER BY s.start_date`, s.params);
  const fs = scope(req.user);
  const money = await db.one(
    `SELECT COALESCE(SUM(CASE WHEN p.payment_type='CHARGE' THEN p.amount END),0) AS gross,
            COALESCE(SUM(CASE WHEN p.payment_type='REFUND' THEN p.amount END),0) AS refunds,
            COUNT(CASE WHEN p.payment_type='REFUND' THEN 1 END) AS refund_count
       FROM Payments p
       LEFT JOIN Orders o ON o.order_id = p.order_id
       LEFT JOIN StallAllocations a ON a.allocation_id = p.allocation_id
       LEFT JOIN Stalls st ON st.stall_id = a.stall_id
       JOIN Festivals f ON f.festival_id = COALESCE(o.festival_id, st.festival_id)
      WHERE p.status = 'CAPTURED' AND ${fs.sql}`,
    fs.params,
  );
  const daily = await db.query(
    `SELECT DATE(p.processed_at) AS day,
            SUM(CASE WHEN p.payment_type='CHARGE' THEN p.amount ELSE 0 END) AS revenue,
            SUM(CASE WHEN p.payment_type='REFUND' THEN p.amount ELSE 0 END) AS refunds,
            COUNT(DISTINCT CASE WHEN p.payment_type='CHARGE' THEN p.order_id END) AS orders
       FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
      WHERE p.status = 'CAPTURED' AND p.processed_at >= CURDATE() - INTERVAL 29 DAY AND ${fs.sql}
      GROUP BY DATE(p.processed_at) ORDER BY day`,
    fs.params,
  );
  const methods = await db.query(
    `SELECT p.method, COUNT(*) AS n, SUM(p.amount) AS amount
       FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
      WHERE p.status = 'CAPTURED' AND p.payment_type = 'CHARGE' AND ${fs.sql} GROUP BY p.method`,
    fs.params,
  );
  const pendingApps = await db.one(
    `SELECT COUNT(*) AS n FROM StallAllocations a JOIN Stalls st ON st.stall_id = a.stall_id
       JOIN Festivals f ON f.festival_id = st.festival_id WHERE a.status = 'APPLIED' AND ${fs.sql}`,
    fs.params,
  );
  const pendingVendors = await db.one("SELECT COUNT(*) AS n FROM Vendors WHERE status = 'PENDING_REVIEW'");
  const transfers = await db.one(
    `SELECT COUNT(*) AS n FROM TicketTransfers tt JOIN Tickets tk ON tk.ticket_id = tt.ticket_id
       JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id WHERE ${fs.sql}`,
    fs.params,
  );
  const recent = await db.query(
    `SELECT o.order_id, o.status, o.created_at, u.full_name AS buyer_name, f.name AS festival_name, ot.ticket_count, ot.total_amount
       FROM Orders o JOIN v_order_totals ot ON ot.order_id = o.order_id
       JOIN Users u ON u.user_id = o.buyer_id JOIN Festivals f ON f.festival_id = o.festival_id
      WHERE ${fs.sql} ORDER BY o.created_at DESC LIMIT 8`,
    fs.params,
  );
  const sum = (k) => festivals.reduce((acc, f) => acc + Number(f[k] || 0), 0);
  res.json({
    totals: {
      festivals: festivals.length,
      live: festivals.filter((f) => f.status === 'LIVE').length,
      on_sale: festivals.filter((f) => f.status === 'ON_SALE').length,
      tickets_sold: sum('tickets_sold'),
      checked_in: sum('checked_in'),
      ticket_revenue: sum('ticket_revenue'),
      stall_revenue: sum('stall_revenue'),
      gross: Number(money.gross), refunds: Number(money.refunds), refund_count: money.refund_count,
      net: Number(money.gross) - Number(money.refunds),
      pending_applications: pendingApps.n,
      pending_vendors: pendingVendors.n,
      transfers: transfers.n,
    },
    festivals, daily, methods, recent_orders: recent,
  });
}));

// Festival report ----------------------------------------------------------
router.get('/festivals/:id/report', ah(async (req, res) => {
  const fid = id(req.params.id);
  await assertFestivalAccess(req.user, fid);
  const stats = await db.one('SELECT * FROM v_festival_stats WHERE festival_id = ?', [fid]);
  const tiers = await db.query(
    `SELECT a.*, COALESCE(r.revenue, 0) AS revenue FROM v_tier_availability a
       LEFT JOIN (SELECT tk.tier_id, SUM(t.price) AS revenue FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id
                   JOIN Orders o ON o.order_id = tk.order_id
                  WHERE o.status = 'PAID' AND tk.status IN ('VALID','CHECKED_IN') GROUP BY tk.tier_id) r ON r.tier_id = a.tier_id
      WHERE a.festival_id = ? ORDER BY a.price`,
    [fid],
  );
  const daily = await db.query(
    `SELECT DATE(o.paid_at) AS day, COUNT(tk.ticket_id) AS tickets, SUM(t.price) AS revenue
       FROM Orders o JOIN Tickets tk ON tk.order_id = o.order_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
      WHERE o.festival_id = ? AND o.paid_at IS NOT NULL GROUP BY DATE(o.paid_at) ORDER BY day`,
    [fid],
  );
  const gates = await db.query(
    `SELECT gs.gate_code, gs.direction, gs.result, COUNT(*) AS n
       FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
      WHERE t.festival_id = ? GROUP BY gs.gate_code, gs.direction, gs.result ORDER BY gs.gate_code`,
    [fid],
  );
  const hourly = await db.query(
    `SELECT DATE_FORMAT(gs.scanned_at, '%Y-%m-%d %H:00') AS hour,
            SUM(gs.direction='IN' AND gs.result='ACCEPTED') AS entries,
            SUM(gs.direction='OUT' AND gs.result='ACCEPTED') AS exits,
            SUM(gs.result<>'ACCEPTED') AS rejected
       FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
      WHERE t.festival_id = ? GROUP BY hour ORDER BY hour`,
    [fid],
  );
  const inside = await db.one(
    `SELECT COUNT(*) AS n FROM v_ticket_last_scan ls JOIN Tickets tk ON tk.ticket_id = ls.ticket_id
       JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = ? AND ls.direction = 'IN'`,
    [fid],
  );
  const orders = await db.one(
    `SELECT COUNT(*) AS total, SUM(status='PAID') AS paid, SUM(status='PENDING') AS pending, SUM(status='EXPIRED') AS expired,
            SUM(status='CANCELLED') AS cancelled, SUM(status='REFUNDED') AS refunded FROM Orders WHERE festival_id = ?`,
    [fid],
  );
  const refunds = await db.one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(p.amount),0) AS amount FROM Payments p JOIN Orders o ON o.order_id = p.order_id
      WHERE o.festival_id = ? AND p.payment_type = 'REFUND' AND p.status = 'CAPTURED'`,
    [fid],
  );
  res.json({ stats, tiers, daily, gates, hourly, inside_now: inside.n, orders, refunds });
}));

router.get('/festivals/:id/attendees', ah(async (req, res) => {
  const fid = id(req.params.id);
  await assertFestivalAccess(req.user, fid);
  const params = [fid];
  let extra = '';
  if (req.query.q) { extra += ' AND (hu.full_name LIKE ? OR hu.email LIKE ? OR tk.ticket_id LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`, `${req.query.q}%`); }
  if (req.query.status) { extra += ' AND tk.status = ?'; params.push(req.query.status); }
  const rows = await db.query(
    `SELECT tk.ticket_id, t.tier_name, t.price, tk.status AS ticket_status, o.order_id, o.status AS order_status,
            hu.full_name AS holder_name, hu.email AS holder_email, bu.full_name AS buyer_name,
            TIMESTAMPDIFF(YEAR, hu.date_of_birth, f.start_date) AS age_at_start,
            (SELECT COUNT(*) FROM TicketTransfers tt WHERE tt.ticket_id = tk.ticket_id) AS transferred,
            ls.direction AS last_scan, ls.scanned_at AS last_scan_at, tk.issued_at
       FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
       JOIN Orders o ON o.order_id = tk.order_id JOIN Users hu ON hu.user_id = tk.holder_id JOIN Users bu ON bu.user_id = o.buyer_id
       LEFT JOIN v_ticket_last_scan ls ON ls.ticket_id = tk.ticket_id
      WHERE t.festival_id = ? AND o.status IN ('PAID','REFUNDED','CANCELLED') ${extra}
      ORDER BY hu.full_name LIMIT 2000`,
    params,
  );
  sendMaybeCsv(req, res, rows, `attendees-festival-${fid}`, 'attendees');
}));

// Ledgers & audit ----------------------------------------------------------
router.get('/payments', ah(async (req, res) => {
  const fs = scope(req.user);
  const where = [fs.sql];
  const params = [...fs.params];
  const { festival_id, type, status, context, from, to } = req.query;
  if (festival_id) { where.push('f.festival_id = ?'); params.push(Number(festival_id)); }
  if (type) { where.push('p.payment_type = ?'); params.push(type); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (context === 'TICKET_ORDER') where.push('p.order_id IS NOT NULL');
  if (context === 'STALL_FEE') where.push('p.allocation_id IS NOT NULL');
  if (from) { where.push('p.processed_at >= ?'); params.push(from); }
  if (to) { where.push('p.processed_at < ? + INTERVAL 1 DAY'); params.push(to); }
  const rows = await db.query(
    `SELECT p.payment_id, p.processed_at, p.payment_type, p.status, p.amount, p.currency, p.method, p.provider_ref,
            p.order_id, p.allocation_id, IF(p.order_id IS NULL, 'STALL_FEE', 'TICKET_ORDER') AS context,
            f.festival_id, f.name AS festival_name,
            COALESCE(bu.full_name, v.legal_name) AS counterparty
       FROM Payments p
       LEFT JOIN Orders o ON o.order_id = p.order_id
       LEFT JOIN Users bu ON bu.user_id = o.buyer_id
       LEFT JOIN StallAllocations a ON a.allocation_id = p.allocation_id
       LEFT JOIN Vendors v ON v.vendor_id = a.vendor_id
       LEFT JOIN Stalls st ON st.stall_id = a.stall_id
       JOIN Festivals f ON f.festival_id = COALESCE(o.festival_id, st.festival_id)
      WHERE ${where.join(' AND ')}
      ORDER BY p.processed_at DESC, p.payment_id DESC LIMIT 1000`,
    params,
  );
  sendMaybeCsv(req, res, rows, 'payments', 'payments');
}));

/** Reconciliation (rule 13 / auditor persona): orders whose ledger does not match their tickets. */
router.get('/reconciliation', ah(async (req, res) => {
  const fs = scope(req.user);
  const rows = await db.query(
    `SELECT ot.order_id, ot.status, f.name AS festival_name, ot.ticket_count, ot.total_amount, ot.captured_amount, ot.refunded_amount,
            (ot.refunded_amount <= ot.captured_amount) AS refund_within_capture,
            CASE WHEN ot.status = 'PAID' AND ot.captured_amount < ot.total_amount THEN 'UNDERPAID'
                 WHEN ot.status IN ('EXPIRED','CANCELLED') AND ot.captured_amount > ot.refunded_amount THEN 'CAPTURED_ON_DEAD_ORDER'
                 WHEN ot.refunded_amount > ot.captured_amount THEN 'OVER_REFUNDED'
                 ELSE 'OK' END AS verdict
       FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id
      WHERE ${fs.sql}
      HAVING verdict <> 'OK' OR ? = 'all'
      ORDER BY ot.order_id DESC LIMIT 500`,
    [...fs.params, req.query.show || ''],
  );
  const summary = await db.one(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(ot.captured_amount),0) AS captured, COALESCE(SUM(ot.refunded_amount),0) AS refunded
       FROM v_order_totals ot JOIN Festivals f ON f.festival_id = ot.festival_id WHERE ${fs.sql}`,
    fs.params,
  );
  res.json({ issues: rows, summary });
}));

router.get('/transfers', ah(async (req, res) => {
  const fs = scope(req.user);
  const rows = await db.query(
    `SELECT tt.transfer_id, tt.transferred_at, tt.ticket_id, t.tier_name, f.name AS festival_name,
            fu.full_name AS from_name, fu.email AS from_email, tu.full_name AS to_name, tu.email AS to_email
       FROM TicketTransfers tt JOIN Tickets tk ON tk.ticket_id = tt.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
       JOIN Festivals f ON f.festival_id = t.festival_id
       JOIN Users fu ON fu.user_id = tt.from_user_id JOIN Users tu ON tu.user_id = tt.to_user_id
      WHERE ${fs.sql} ORDER BY tt.transferred_at DESC LIMIT 1000`,
    fs.params,
  );
  sendMaybeCsv(req, res, rows, 'transfers', 'transfers');
}));

router.get('/scans', ah(async (req, res) => {
  const fs = scope(req.user);
  const where = [fs.sql];
  const params = [...fs.params];
  if (req.query.festival_id) { where.push('f.festival_id = ?'); params.push(Number(req.query.festival_id)); }
  if (req.query.result) { where.push('gs.result = ?'); params.push(req.query.result); }
  if (req.query.ticket_id) { where.push('gs.ticket_id = ?'); params.push(req.query.ticket_id); }
  const rows = await db.query(
    `SELECT gs.scan_id, gs.scanned_at, gs.gate_code, gs.direction, gs.result, gs.ticket_id,
            hu.full_name AS holder_name, su.full_name AS staff_name, t.tier_name, f.name AS festival_name
       FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
       JOIN Festivals f ON f.festival_id = t.festival_id JOIN Users hu ON hu.user_id = tk.holder_id
       JOIN Users su ON su.user_id = gs.staff_id
      WHERE ${where.join(' AND ')} ORDER BY gs.scanned_at DESC LIMIT 1000`,
    params,
  );
  sendMaybeCsv(req, res, rows, 'gate-scans', 'scans');
}));

/** Full audit trail for one ticket: who bought it, who received it, where and when it was scanned. */
router.get('/tickets/:ticketId/trail', ah(async (req, res) => {
  const tid = String(req.params.ticketId);
  const tk = await db.one(
    `SELECT tk.ticket_id, tk.status, tk.issued_at, t.tier_name, t.price, f.festival_id, f.name AS festival_name, f.organizer_id,
            o.order_id, o.status AS order_status, o.created_at AS ordered_at, o.paid_at,
            bu.full_name AS buyer_name, bu.email AS buyer_email, hu.full_name AS holder_name, hu.email AS holder_email
       FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
       JOIN Orders o ON o.order_id = tk.order_id JOIN Users bu ON bu.user_id = o.buyer_id JOIN Users hu ON hu.user_id = tk.holder_id
      WHERE tk.ticket_id = ?`,
    [tid],
  );
  if (!tk) throw notFound('Ticket not found');
  if (req.user.role === 'ORGANIZER' && tk.organizer_id !== req.user.user_id) throw forbidden();
  const transfers = await db.query(
    `SELECT tt.transferred_at, fu.full_name AS from_name, tu.full_name AS to_name FROM TicketTransfers tt
       JOIN Users fu ON fu.user_id = tt.from_user_id JOIN Users tu ON tu.user_id = tt.to_user_id WHERE tt.ticket_id = ?`,
    [tid],
  );
  const scans = await db.query(
    `SELECT gs.scanned_at, gs.gate_code, gs.direction, gs.result, su.full_name AS staff_name FROM GateScans gs
       JOIN Users su ON su.user_id = gs.staff_id WHERE gs.ticket_id = ? ORDER BY gs.scanned_at`,
    [tid],
  );
  const payments = await db.query('SELECT * FROM Payments WHERE order_id = ? ORDER BY processed_at', [tk.order_id]);
  res.json({ ticket: tk, transfers, scans, payments });
}));

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
