const db = require('../db');

const REASONS = {
  UNKNOWN_TOKEN: 'QR code not recognised (fake, or replaced after a transfer)',
  WRONG_FESTIVAL: 'Ticket is for a different festival',
  TICKET_NOT_VALID: 'Ticket is refunded, void or unpaid',
  NOT_LIVE: 'Festival is not in progress',
  ALREADY_INSIDE: 'Ticket is already inside (anti-passback)',
  NOT_INSIDE: 'Ticket has no accepted entry to exit from',
  OK_IN: 'Welcome in',
  OK_OUT: 'Exit recorded',
};

/**
 * Rule 8 anti-passback. The ticket row is locked FOR UPDATE so the same QR shown at
 * two gates in the same second is serialised (Part 3 d, case 2): the second scan
 * sees the first IN and is recorded as REJECTED_DUPLICATE.
 */
async function scan(staff, { qr_token, gate_code, direction, festival_id }) {
  return db.tx(async (t) => {
    const tk = await t.one(
      `SELECT tk.ticket_id, tk.status, o.status AS order_status, ti.tier_name,
              f.festival_id, f.name AS festival_name, f.status AS festival_status,
              (CURDATE() BETWEEN f.start_date AND f.end_date) AS in_dates,
              u.full_name AS holder_name, u.date_of_birth
         FROM Tickets tk
         JOIN Orders o ON o.order_id = tk.order_id
         JOIN TicketTiers ti ON ti.tier_id = tk.tier_id
         JOIN Festivals f ON f.festival_id = ti.festival_id
         JOIN Users u ON u.user_id = tk.holder_id
        WHERE tk.qr_token = ? FOR UPDATE`,
      [qr_token],
    );
    if (!tk) {
      // Nothing to attach a GateScans row to (ticket_id is a NOT NULL FK).
      return { result: 'REJECTED_INVALID', reason_code: 'UNKNOWN_TOKEN', message: REASONS.UNKNOWN_TOKEN, recorded: false };
    }

    let result = 'ACCEPTED';
    let reason = direction === 'IN' ? 'OK_IN' : 'OK_OUT';
    const last = await t.one(
      `SELECT direction, gate_code, scanned_at FROM GateScans
        WHERE ticket_id = ? AND result = 'ACCEPTED' ORDER BY scanned_at DESC, scan_id DESC LIMIT 1`,
      [tk.ticket_id],
    );

    if (festival_id && Number(festival_id) !== tk.festival_id) {
      result = 'REJECTED_INVALID'; reason = 'WRONG_FESTIVAL';
    } else if (!['VALID', 'CHECKED_IN'].includes(tk.status) || tk.order_status !== 'PAID') {
      result = 'REJECTED_INVALID'; reason = 'TICKET_NOT_VALID';
    } else if (tk.festival_status !== 'LIVE' || !tk.in_dates) {
      result = 'REJECTED_NOT_LIVE'; reason = 'NOT_LIVE';
    } else if (direction === 'IN' && last && last.direction === 'IN') {
      result = 'REJECTED_DUPLICATE'; reason = 'ALREADY_INSIDE';
    } else if (direction === 'OUT' && (!last || last.direction !== 'IN')) {
      result = 'REJECTED_INVALID'; reason = 'NOT_INSIDE';
    }

    const ins = await t.query(
      'INSERT INTO GateScans (ticket_id, staff_id, gate_code, direction, result) VALUES (?, ?, ?, ?, ?)',
      [tk.ticket_id, staff.user_id, gate_code, direction, result],
    );
    if (result === 'ACCEPTED' && direction === 'IN' && tk.status === 'VALID') {
      await t.query("UPDATE Tickets SET status = 'CHECKED_IN' WHERE ticket_id = ?", [tk.ticket_id]);
    }
    return {
      scan_id: ins.insertId,
      result,
      reason_code: reason,
      message: REASONS[reason],
      recorded: true,
      ticket: {
        ticket_id: tk.ticket_id, holder_name: tk.holder_name, tier_name: tk.tier_name,
        festival_name: tk.festival_name, status: result === 'ACCEPTED' && direction === 'IN' ? 'CHECKED_IN' : tk.status,
      },
      previous_scan: last,
    };
  });
}

async function recentForStaff(staff, limit = 25) {
  return db.query(
    `SELECT gs.scan_id, gs.scanned_at, gs.gate_code, gs.direction, gs.result, u.full_name AS holder_name,
            ti.tier_name, f.name AS festival_name
       FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id
       JOIN Users u ON u.user_id = tk.holder_id JOIN TicketTiers ti ON ti.tier_id = tk.tier_id
       JOIN Festivals f ON f.festival_id = ti.festival_id
      WHERE gs.staff_id = ? ORDER BY gs.scanned_at DESC LIMIT ?`,
    [staff.user_id, limit],
  );
}

module.exports = { scan, recentForStaff, REASONS };
