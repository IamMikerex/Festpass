/**
 * Prints real QR codes from the database for the gate scanner demo, one for each outcome.
 * The codes change on every reset, so run this after "npm run demo:reset".
 * Usage: npm run demo:qr
 * Paste a code into the scanner's "Type the code" box, or scan the holder's QR on screen.
 */
const crypto = require('crypto');
const db = require('../src/db');

const LIVE = 'Bosphorus Beats';

const rowFor = (where, params = []) => db.one(
  `SELECT tk.qr_token, tk.status, u.full_name, u.email, ti.tier_name, f.name AS festival
     FROM Tickets tk JOIN TicketTiers ti ON ti.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = ti.festival_id
     JOIN Users u ON u.user_id = tk.holder_id
     LEFT JOIN v_ticket_last_scan ls ON ls.ticket_id = tk.ticket_id
    WHERE ${where} ORDER BY tk.ticket_id LIMIT 1`,
  params,
);

async function run() {
  const cases = [
    ['Admit: Ayse, valid ticket (scan twice to see the duplicate refusal)', await rowFor("u.email = 'ayse@festpass.com' AND f.name = ? AND tk.status = 'VALID'", [LIVE])],
    ['Admit: Can, valid ticket', await rowFor("u.email = 'can@festpass.com' AND f.name = ? AND tk.status = 'VALID'", [LIVE])],
    ['Refuse IN: already inside (duplicate). Choose OUT to let them leave', await rowFor("f.name = ? AND tk.status = 'CHECKED_IN' AND ls.direction = 'IN'", [LIVE])],
    ['Admit again: checked in earlier, then left (re-entry)', await rowFor("f.name = ? AND tk.status = 'CHECKED_IN' AND ls.direction = 'OUT'", [LIVE])],
    ['Refuse: refunded ticket', await rowFor("tk.status = 'REFUNDED' AND f.name = 'Istanbul Sound Festival'")],
    ['Refuse: voided ticket (expired checkout)', await rowFor("tk.status = 'VOID' AND f.name = 'Istanbul Sound Festival'")],
    [`Refuse: ticket for another festival (keep "${LIVE}" selected)`, await rowFor("f.name = 'Istanbul Sound Festival' AND tk.status = 'VALID'")],
  ];
  console.log(`\nGate scanner demo codes (sign in as gate@festpass.com, pick "${LIVE}")\n`);
  for (const [title, r] of cases) {
    if (!r) { console.log(`${title}\n  (no matching ticket: run npm run demo:reset)\n`); continue; }
    console.log(`${title}\n  ${r.full_name} · ${r.festival} · ${r.tier_name} · ${r.status}\n  ${r.qr_token}\n`);
  }
  console.log(`Refuse: not a FestPass ticket (made-up code)\n  ${crypto.randomBytes(32).toString('hex')}\n`);
  await db.pool.end();
}

run().catch(async (e) => { console.error(e.message); try { await db.pool.end(); } catch { /* ignore */ } process.exit(1); });
