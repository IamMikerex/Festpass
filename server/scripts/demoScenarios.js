/**
 * Demo scenarios for the class presentation. Run AFTER initDb.js (npm run demo:reset does both).
 *
 * Everything here goes through the real REST API, signed in as the user who would do it in
 * the app (organizer, vendor manager, attendee, gate staff). Every validation, permission check,
 * business rule and database trigger therefore applies exactly as it does in the browser; if a
 * rule ever changes, this script fails instead of writing data the rules would not allow.
 *
 * Two rules depend on time passing (rule 3: 10-minute checkout hold, rule 11: 7-day stall-fee
 * deadline). For those, the script moves that one record's clock back (expires_at / approved_at)
 * and then runs the app's own scheduled job, which applies the rule.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test'; // quiet request logging
const app = require('../src/app');
const db = require('../src/db');
const jobs = require('../src/jobs');

let base;
const tokens = {};

async function api(method, url, { as, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as) headers.authorization = `Bearer ${await token(as)}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function token(email) {
  if (!tokens[email]) {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!' }),
    });
    const d = await r.json();
    if (!d.token) throw new Error(`Could not sign in as ${email}: ${JSON.stringify(d)}`);
    tokens[email] = d.token;
  }
  return tokens[email];
}

/** Calls the API and fails loudly unless the status is the one the scenario expects. */
async function expect(status, method, url, opts) {
  const r = await api(method, url, opts);
  if (r.status !== status) throw new Error(`${method} ${url} as ${opts && opts.as}: expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

const log = (s) => console.log(`  - ${s}`);
const ORG = 'organizer@festpass.com';
const GATE = 'gate@festpass.com';
const VM1 = 'vendor@festpass.com';
const VM2 = 'vendor2@festpass.com';
const CARD = '4111111111111111';
const DECLINED_CARD = '4000000000000002'; // the simulated gateway declines cards ending in 0002

const festId = async (name) => (await db.one('SELECT festival_id FROM Festivals WHERE name = ?', [name])).festival_id;
const tierId = async (fid, name) => (await db.one('SELECT tier_id FROM TicketTiers WHERE festival_id = ? AND tier_name = ?', [fid, name])).tier_id;
const stallId = async (fid, code) => (await db.one('SELECT stall_id FROM Stalls WHERE festival_id = ? AND stall_code = ?', [fid, code])).stall_id;
const vendorId = async (tax) => (await db.one('SELECT vendor_id FROM Vendors WHERE tax_number = ?', [tax])).vendor_id;

async function buy(email, festivalId, tier, quantity, { method = 'CARD', holders } = {}) {
  const items = [{ tier_id: tier, quantity, ...(holders ? { holder_emails: holders } : {}) }];
  const o = await expect(201, 'POST', '/orders', { as: email, body: { festival_id: festivalId, items } });
  const id = o.order.order_id;
  await expect(200, 'POST', `/orders/${id}/pay`, { as: email, body: { method, ...(method === 'CARD' ? { card_number: CARD } : {}) } });
  return id;
}

/** A seeded fan's own VALID, never-transferred ticket at a festival (buyer = holder, so they may refund it). */
async function fanTicket(festivalId, skip = []) {
  return db.one(
    `SELECT tk.ticket_id, u.email FROM Tickets tk
       JOIN Orders o ON o.order_id = tk.order_id JOIN TicketTiers ti ON ti.tier_id = tk.tier_id
       JOIN Users u ON u.user_id = tk.holder_id
      WHERE ti.festival_id = ? AND tk.status = 'VALID' AND o.status = 'PAID' AND o.buyer_id = tk.holder_id
        AND u.email LIKE 'fan%@example.com' AND tk.ticket_id NOT IN (SELECT ticket_id FROM TicketTransfers)
        ${skip.length ? 'AND u.email NOT IN (?)' : ''}
      ORDER BY o.order_id LIMIT 1`,
    skip.length ? [festivalId, skip] : [festivalId],
  );
}

async function run() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  console.log('Running demo scenarios through the API...');

  const f1 = await festId('Istanbul Sound Festival');
  const f2 = await festId('Bosphorus Beats');
  const f3 = await festId('Aegean Waves');
  const f4 = await festId('Antalya Sunset Sessions');
  const v1 = await vendorId('1234567890'); // Anadolu Lezzetleri (FOOD, vendor@)
  const v3 = await vendorId('3456789012'); // Retro Merch (MERCH, vendor2@)

  // ---------------------------------------------------------------- 1. Cancelled festival (rule 7)
  const d = await db.one(
    `SELECT DATE_FORMAT(CURDATE() + INTERVAL 30 DAY, '%Y-%m-%d') AS s, DATE_FORMAT(CURDATE() + INTERVAL 31 DAY, '%Y-%m-%d') AS e,
            DATE_FORMAT(NOW() - INTERVAL 1 HOUR, '%Y-%m-%d %H:%i') AS open, DATE_FORMAT(CURDATE() + INTERVAL 29 DAY, '%Y-%m-%d 23:00') AS close`,
  );
  const jazz = (await expect(201, 'POST', '/festivals', {
    as: ORG,
    body: { name: 'Black Sea Jazz Days', venue_name: 'Trabzon Meydan Park', city: 'Trabzon', start_date: d.s, end_date: d.e, daily_capacity: 1200, min_age: 16 },
  })).festival_id;
  for (const [tier_name, price, quota] of [['General', 800, 1000], ['Front Row', 1600, 150]]) {
    await expect(201, 'POST', `/festivals/${jazz}/tiers`, { as: ORG, body: { tier_name, price, quota, max_per_order: 6, sale_start: d.open, sale_end: d.close } });
  }
  await expect(201, 'POST', `/festivals/${jazz}/stalls`, { as: ORG, body: { stall_code: 'F-01', zone: 'FOOD_COURT', size_m2: 12, has_power: true, base_fee: 8000 } });
  await expect(200, 'POST', `/festivals/${jazz}/status`, { as: ORG, body: { status: 'ON_SALE' } });
  const jazzGen = await tierId(jazz, 'General');
  const jazzFront = await tierId(jazz, 'Front Row');
  for (let i = 11; i <= 20; i += 1) await buy(`fan${i}@example.com`, jazz, i % 3 ? jazzGen : jazzFront, 1 + (i % 2), { method: ['CARD', 'WALLET', 'BANK_TRANSFER'][i % 3] });
  await expect(201, 'POST', '/orders', { as: 'fan21@example.com', body: { festival_id: jazz, items: [{ tier_id: jazzGen, quantity: 2 }] } }); // still in checkout
  const jazzAlloc = (await expect(201, 'POST', '/allocations', { as: VM1, body: { vendor_id: v1, stall_id: await stallId(jazz, 'F-01') } })).allocation.allocation_id;
  await expect(200, 'POST', `/allocations/${jazzAlloc}/approve`, { as: ORG, body: {} });
  await expect(200, 'POST', `/allocations/${jazzAlloc}/pay`, { as: VM1, body: { method: 'BANK_TRANSFER' } });
  const cancelled = await expect(200, 'POST', `/festivals/${jazz}/status`, { as: ORG, body: { status: 'CANCELLED' } });
  log(`Black Sea Jazz Days sold, then cancelled: ${cancelled.summary.tickets_refunded} tickets refunded 100 %, ${cancelled.summary.pending_cancelled} open checkout voided, stall fee returned`);

  // ---------------------------------------------------------------- 2. Failed payment, then success (rule 13)
  const f3Gen = await tierId(f3, 'General');
  const failed = (await expect(201, 'POST', '/orders', { as: 'elif@festpass.com', body: { festival_id: f3, items: [{ tier_id: f3Gen, quantity: 1 }] } })).order.order_id;
  await expect(402, 'POST', `/orders/${failed}/pay`, { as: 'elif@festpass.com', body: { method: 'CARD', card_number: DECLINED_CARD } });
  await expect(200, 'POST', `/orders/${failed}/pay`, { as: 'elif@festpass.com', body: { method: 'WALLET' } });
  log('Elif: card declined at Aegean Waves checkout, then paid by wallet (FAILED + CAPTURED payment rows)');

  // ---------------------------------------------------------------- 3. Checkout hold expired (rule 3)
  const f1Early = await tierId(f1, 'Early Bird');
  const expiring = (await expect(201, 'POST', '/orders', { as: 'can@festpass.com', body: { festival_id: f1, items: [{ tier_id: f1Early, quantity: 2 }] } })).order.order_id;
  await db.query('UPDATE Orders SET created_at = NOW() - INTERVAL 25 MINUTE, expires_at = NOW() - INTERVAL 15 MINUTE WHERE order_id = ?', [expiring]); // 15 minutes "pass"
  await jobs.runOnce({ log() {}, error: console.error });
  const exp = await db.one('SELECT status FROM Orders WHERE order_id = ?', [expiring]);
  if (exp.status !== 'EXPIRED') throw new Error(`Expiry job did not expire order ${expiring}`);
  log('Can: left a 2-ticket checkout open for 15 minutes; the expiry job released it (order EXPIRED, tickets VOID)');

  // ---------------------------------------------------------------- 4. Checkout cancelled by the buyer
  const f1Gen = await tierId(f1, 'General');
  const dropped = (await expect(201, 'POST', '/orders', { as: 'fan22@example.com', body: { festival_id: f1, items: [{ tier_id: f1Gen, quantity: 1 }] } })).order.order_id;
  await expect(200, 'POST', `/orders/${dropped}/cancel`, { as: 'fan22@example.com' });
  log('fan22: cancelled a checkout before paying (order CANCELLED, ticket VOID)');

  // ---------------------------------------------------------------- 5. Refunds in each band (rule 6) and transfers (rule 5)
  for (const [fid, label] of [[f1, '45 days out, 90 %'], [f3, '15 days out, 50 %']]) {
    const t = await fanTicket(fid);
    const r = await expect(200, 'POST', `/tickets/${t.ticket_id}/refund`, { as: t.email });
    log(`${t.email.split('@')[0]}: refunded a ticket (${label}): ${r.amount} TRY back`);
  }
  const tr = await fanTicket(f1);
  await expect(200, 'POST', `/tickets/${tr.ticket_id}/transfer`, { as: tr.email, body: { email: 'fan30@example.com' } });
  log(`${tr.email.split('@')[0]}: transferred an Istanbul Sound Festival ticket to fan30 (new QR issued)`);

  // ---------------------------------------------------------------- 6. Stall applications in every stage (rules 9, 10, 11)
  // a) approved, then the 7-day fee deadline passed unpaid -> cancelled by the job
  const late = (await expect(201, 'POST', '/allocations', { as: VM2, body: { vendor_id: v3, stall_id: await stallId(f1, 'C-01') } })).allocation.allocation_id;
  await expect(200, 'POST', `/allocations/${late}/approve`, { as: ORG, body: {} });
  await db.query('UPDATE StallAllocations SET applied_at = NOW() - INTERVAL 11 DAY, approved_at = NOW() - INTERVAL 9 DAY WHERE allocation_id = ?', [late]); // 9 days "pass"
  await jobs.runOnce({ log() {}, error: console.error });
  if ((await db.one('SELECT status FROM StallAllocations WHERE allocation_id = ?', [late])).status !== 'CANCELLED') throw new Error('Fee-deadline job did not cancel the allocation');
  log('Retro Merch: approved for stall C-01 but never paid; the 7-day fee deadline cancelled it');
  // b) approved + paid, then the vendor pulled out less than 21 days before start -> 50 % forfeited
  const pulled = (await expect(201, 'POST', '/allocations', { as: VM2, body: { vendor_id: v3, stall_id: await stallId(f3, 'F-02') } })).allocation.allocation_id;
  await expect(200, 'POST', `/allocations/${pulled}/approve`, { as: ORG, body: {} });
  await expect(200, 'POST', `/allocations/${pulled}/pay`, { as: VM2, body: { method: 'CARD', card_number: CARD } });
  const pc = await expect(200, 'POST', `/allocations/${pulled}/cancel`, { as: VM2 });
  log(`Retro Merch: paid for Aegean Waves stall F-02, then cancelled 15 days out: ${pc.refund} TRY back, ${pc.forfeited} TRY forfeited`);
  // c) a new vendor is reviewed, applies, and is then blacklisted -> its open application is rejected
  const shady = (await expect(201, 'POST', '/vendors', {
    as: VM2,
    body: { legal_name: 'Kordon Street Snacks', tax_number: '6789012345', category: 'FOOD', license_expiry: '2030-12-31', hygiene_cert_expiry: '2030-12-31' },
  })).vendor_id;
  await expect(200, 'POST', `/vendors/${shady}/status`, { as: ORG, body: { status: 'ACTIVE' } });
  await expect(201, 'POST', '/allocations', { as: VM2, body: { vendor_id: shady, stall_id: await stallId(f1, 'F-05') } });
  await expect(200, 'POST', `/vendors/${shady}/status`, { as: ORG, body: { status: 'BLACKLISTED' } });
  log('Kordon Street Snacks: approved, applied for F-05, then blacklisted (open application auto-rejected)');

  // ---------------------------------------------------------------- 7. Gate activity through the real scanner endpoint
  const f2Valid = await db.query(
    `SELECT tk.qr_token FROM Tickets tk JOIN TicketTiers ti ON ti.tier_id = tk.tier_id JOIN Users u ON u.user_id = tk.holder_id
      WHERE ti.festival_id = ? AND tk.status = 'VALID' AND u.email LIKE 'fan%@example.com' ORDER BY tk.ticket_id LIMIT 6`,
    [f2],
  );
  const scan = (qr_token, direction = 'IN', gate_code = 'NORTH-1', festival_id = f2) =>
    expect(200, 'POST', '/scans', { as: GATE, body: { qr_token, gate_code, direction, ...(festival_id ? { festival_id } : {}) } });
  let accepted = 0;
  for (const [i, t] of f2Valid.entries()) {
    const r = await scan(t.qr_token, 'IN', i % 2 ? 'NORTH-2' : 'SOUTH-1');
    if (r.result === 'ACCEPTED') accepted += 1;
  }
  const dup = await scan(f2Valid[0].qr_token);          // already inside
  const out = await scan(f2Valid[1].qr_token, 'OUT');     // steps out for a while
  const f1Qr = (await db.one(
    "SELECT tk.qr_token FROM Tickets tk JOIN TicketTiers ti ON ti.tier_id = tk.tier_id WHERE ti.festival_id = ? AND tk.status = 'VALID' ORDER BY tk.ticket_id LIMIT 1", [f1],
  )).qr_token;
  const wrong = await scan(f1Qr);                         // Istanbul ticket at the Bosphorus gate
  const notLive = await scan(f1Qr, 'IN', 'NORTH-1', null); // same ticket, no festival picked: festival not running
  const refundedQr = (await db.one("SELECT qr_token FROM Tickets WHERE status = 'REFUNDED' ORDER BY ticket_id LIMIT 1")).qr_token;
  const bad = await scan(refundedQr);                     // refunded ticket
  log(`Gate: ${accepted} entries, then repeat entry ${dup.result}, exit ${out.result}, wrong festival ${wrong.result}, not running ${notLive.result}, refunded ${bad.result}`);

  // ---------------------------------------------------------------- 8. Rules that refuse (nothing is written)
  const f4Pass = await tierId(f4, 'Sunset Pass');
  await expect(409, 'POST', '/orders', { as: 'deniz@festpass.com', body: { festival_id: f4, items: [{ tier_id: f4Pass, quantity: 1 }] } });
  await expect(409, 'POST', '/orders', { as: 'elif@festpass.com', body: { festival_id: f4, items: [{ tier_id: f4Pass, quantity: 10 }] } });
  log('Checked: under-age purchase (rule 4) and an 11th ticket (rule 1) are refused');

  server.close();
  await db.pool.end();
  console.log('Demo scenarios ready. Run "npm run demo:qr" for gate scanner test codes.');
}

run().catch(async (e) => {
  console.error(`\nDemo scenarios failed: ${e.message}`);
  try { await db.pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
