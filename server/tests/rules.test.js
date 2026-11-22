/**
 * End-to-end business-rule tests against a real MySQL database.
 * WARNING: re-creates the `festpass` database from schema.sql + seed.sql.
 *   cd server && npm test
 */
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

let server;
let base;
const tokens = {};

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const login = async (email) => (await api('POST', '/auth/login', { body: { email, password: 'Password123!' } })).data.token;

before(async () => {
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'initDb.js')], { stdio: 'ignore' });
  const app = require('../src/app');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const u of ['ayse', 'can', 'elif', 'deniz', 'organizer', 'organizer2', 'gate', 'auditor', 'vendor', 'vendor2']) {
    tokens[u] = await login(`${u}@festpass.com`);
  }
});
after(async () => { server.close(); await require('../src/db').pool.end(); });

const tierOf = async (festivalId, name) => (await api('GET', `/festivals/${festivalId}`)).data.tiers.find((t) => t.tier_name === name);

test('auth: register, duplicate email, wrong password, role escalation blocked', async () => {
  const r = await api('POST', '/auth/register', { body: { email: 'new.fan@example.com', password: 'Secret123', full_name: 'New Fan', date_of_birth: '2000-05-05' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'ATTENDEE');
  assert.equal((await api('POST', '/auth/register', { body: { email: 'new.fan@example.com', password: 'Secret123', full_name: 'X Y', date_of_birth: '2000-05-05' } })).status, 409);
  assert.equal((await api('POST', '/auth/register', { body: { email: 'boss@example.com', password: 'Secret123', full_name: 'Boss', date_of_birth: '2000-05-05', role: 'ORGANIZER' } })).status, 400);
  assert.equal((await api('POST', '/auth/login', { body: { email: 'ayse@festpass.com', password: 'nope' } })).status, 401);
  assert.equal((await api('GET', '/admin/dashboard', { token: tokens.ayse })).status, 403);
});

test('rules 1-3: buy, max per order, 10 per festival, pay, decline, cancel', async () => {
  const vip = await tierOf(1, 'VIP');
  let r = await api('POST', '/orders', { token: tokens.can, body: { festival_id: 1, items: [{ tier_id: vip.tier_id, quantity: 5 }] } });
  assert.equal(r.status, 409, 'VIP max_per_order is 4');
  const gen = await tierOf(1, 'General');
  r = await api('POST', '/orders', { token: tokens.can, body: { festival_id: 1, items: [{ tier_id: gen.tier_id, quantity: 6 }] } });
  assert.equal(r.status, 201);
  assert.equal(r.data.order.status, 'PENDING');
  assert.ok(r.data.order.seconds_left > 590 && r.data.order.seconds_left <= 600, 'rule 3: 10 minute hold');
  const o1 = r.data.order.order_id;
  r = await api('POST', '/orders', { token: tokens.can, body: { festival_id: 1, items: [{ tier_id: gen.tier_id, quantity: 5 }] } });
  assert.equal(r.status, 409, 'rule 1: 6 pending + 5 > 10');
  // declined card leaves the order pending and records a FAILED payment
  r = await api('POST', `/orders/${o1}/pay`, { token: tokens.can, body: { method: 'CARD', card_number: '4111111111110002' } });
  assert.equal(r.status, 402);
  r = await api('POST', `/orders/${o1}/pay`, { token: tokens.can, body: { method: 'CARD', card_number: '4111111111111111' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.order.status, 'PAID');
  assert.equal(r.data.order.payments.filter((p) => p.status === 'FAILED').length, 1);
  r = await api('POST', '/orders', { token: tokens.can, body: { festival_id: 1, items: [{ tier_id: gen.tier_id, quantity: 2 }] } });
  assert.equal(r.status, 201);
  const o2 = r.data.order.order_id;
  assert.equal((await api('POST', `/orders/${o2}/cancel`, { token: tokens.can })).status, 200);
  const after = await api('GET', `/orders/${o2}`, { token: tokens.can });
  assert.equal(after.data.order.status, 'CANCELLED');
  assert.ok(after.data.order.tickets.every((t) => t.status === 'VOID'));
});

test('rule 3: expired hold voids tickets and frees quota', async () => {
  const gen = await tierOf(3, 'General');
  const r = await api('POST', '/orders', { token: tokens.elif, body: { festival_id: 3, items: [{ tier_id: gen.tier_id, quantity: 2 }] } });
  const oid = r.data.order.order_id;
  const db = require('../src/db');
  await db.query('UPDATE Orders SET created_at = NOW() - INTERVAL 20 MINUTE, expires_at = NOW() - INTERVAL 10 MINUTE WHERE order_id = ?', [oid]);
  const pay = await api('POST', `/orders/${oid}/pay`, { token: tokens.elif, body: { method: 'WALLET' } });
  assert.equal(pay.status, 410);
  const o = await api('GET', `/orders/${oid}`, { token: tokens.elif });
  assert.equal(o.data.order.status, 'EXPIRED');
  assert.ok(o.data.order.tickets.every((t) => t.status === 'VOID'));
  // Paying again after the order is already EXPIRED (e.g. closed by the expiry job) is also 410, not 409,
  // so the checkout page shows its "hold expired" screen.
  const again = await api('POST', `/orders/${oid}/pay`, { token: tokens.elif, body: { method: 'WALLET' } });
  assert.equal(again.status, 410);
});

test('stalls: unused stall can be deleted, one with applications cannot', async () => {
  let r = await api('POST', '/festivals/1/stalls', { token: tokens.organizer, body: { stall_code: 'DEL-1', zone: 'CAMPING', size_m2: 6, base_fee: 1000 } });
  assert.equal(r.status, 201);
  assert.equal((await api('DELETE', `/festivals/1/stalls/${r.data.stall_id}`, { token: tokens.organizer })).status, 200);
  r = await api('POST', '/festivals/1/stalls', { token: tokens.organizer, body: { stall_code: 'DEL-2', zone: 'CAMPING', size_m2: 6, base_fee: 1000 } });
  const vendor = (await api('GET', '/vendors/mine', { token: tokens.vendor })).data.vendors.find((v) => v.status === 'ACTIVE');
  assert.equal((await api('POST', '/allocations', { token: tokens.vendor, body: { vendor_id: vendor.vendor_id, stall_id: r.data.stall_id } })).status, 201);
  assert.equal((await api('DELETE', `/festivals/1/stalls/${r.data.stall_id}`, { token: tokens.organizer })).status, 409);
  assert.equal((await api('DELETE', `/festivals/1/stalls/${r.data.stall_id}`, { token: tokens.organizer2 })).status, 403);
});

test('auth: successful sign-ins do not count toward the sign-in limit', async () => {
  for (let i = 0; i < 35; i += 1) {
    const r = await api('POST', '/auth/login', { body: { email: 'gate@festpass.com', password: 'Password123!' } });
    assert.equal(r.status, 200, `sign-in ${i + 1} should succeed`);
  }
});

test('rule 2: quota is hard (sold out)', async () => {
  const db = require('../src/db');
  const back = await tierOf(3, 'Backstage');
  await db.query('UPDATE TicketTiers SET quota = ? WHERE tier_id = ?', [back.sold + 1, back.tier_id]);
  let r = await api('POST', '/orders', { token: tokens.elif, body: { festival_id: 3, items: [{ tier_id: back.tier_id, quantity: 2 }] } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Only 1/);
  r = await api('POST', '/orders', { token: tokens.elif, body: { festival_id: 3, items: [{ tier_id: back.tier_id, quantity: 1 }] } });
  assert.equal(r.status, 201);
  r = await api('POST', '/orders', { token: tokens.can, body: { festival_id: 3, items: [{ tier_id: back.tier_id, quantity: 1 }] } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /sold out/);
});

test('rule 2 concurrency: parallel buyers cannot oversell the last ticket', async () => {
  const db = require('../src/db');
  const gen = await tierOf(4, 'Sunset Pass');
  await db.query('UPDATE TicketTiers SET quota = ? WHERE tier_id = ?', [gen.sold + 1, gen.tier_id]);
  const buyers = ['ayse', 'can', 'organizer2'].map((u) => tokens[u]);
  const extra = [];
  for (let i = 1; i <= 5; i += 1) extra.push(await login(`fan${i}@example.com`));
  const results = await Promise.all([...buyers, ...extra].map((t) => api('POST', '/orders', { token: t, body: { festival_id: 4, items: [{ tier_id: gen.tier_id, quantity: 1 }] } })));
  assert.equal(results.filter((r) => r.status === 201).length, 1, 'exactly one buyer wins');
  const after = await tierOf(4, 'Sunset Pass');
  assert.equal(after.remaining, 0);
});

test('rule 4: under-age holder rejected', async () => {
  const gen = await tierOf(1, 'General');
  let r = await api('POST', '/orders', { token: tokens.deniz, body: { festival_id: 1, items: [{ tier_id: gen.tier_id, quantity: 1 }] } });
  assert.equal(r.status, 409);
  r = await api('POST', '/orders', { token: tokens.ayse, body: { festival_id: 1, items: [{ tier_id: gen.tier_id, quantity: 1, holder_emails: ['deniz@festpass.com'] }] } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /rule 4/);
});

test('rule 5: transfer once, regenerates QR, blocked inside 48h', async () => {
  const mine = (await api('GET', '/tickets', { token: tokens.ayse })).data.tickets;
  const t = mine.find((x) => x.festival_name === 'Istanbul Sound Festival' && x.status === 'VALID');
  const before = (await api('GET', `/tickets/${t.ticket_id}`, { token: tokens.ayse })).data.ticket.qr_token;
  assert.match(before, /^[0-9a-f]{64}$/);
  let r = await api('POST', `/tickets/${t.ticket_id}/transfer`, { token: tokens.ayse, body: { email: 'deniz@festpass.com' } });
  assert.equal(r.status, 409, 'minor recipient');
  r = await api('POST', `/tickets/${t.ticket_id}/transfer`, { token: tokens.ayse, body: { email: 'can@festpass.com' } });
  assert.equal(r.status, 200);
  const nowCan = (await api('GET', `/tickets/${t.ticket_id}`, { token: tokens.can })).data.ticket;
  assert.notEqual(nowCan.qr_token, before);
  r = await api('POST', `/tickets/${t.ticket_id}/transfer`, { token: tokens.can, body: { email: 'elif@festpass.com' } });
  assert.equal(r.status, 409, 'second transfer blocked');
  // old QR no longer admits anyone
  const scan = await api('POST', '/scans', { token: tokens.gate, body: { qr_token: before, gate_code: 'N-1', direction: 'IN' } });
  assert.equal(scan.data.result, 'REJECTED_INVALID');
  // Antalya is 5 days away: inside the window? (5 days > 48h, so allowed); LIVE festival is inside 48h
  const live = mine.find((x) => x.festival_name === 'Bosphorus Beats');
  r = await api('POST', `/tickets/${live.ticket_id}/transfer`, { token: tokens.ayse, body: { email: 'elif@festpass.com' } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /48 hours/);
});

test('rule 6: refund bands 90% / 50% / 0% and no refund after check-in', async () => {
  const gen = await tierOf(1, 'General');
  let r = await api('POST', '/orders', { token: tokens.elif, body: { festival_id: 1, items: [{ tier_id: gen.tier_id, quantity: 1 }] } });
  await api('POST', `/orders/${r.data.order.order_id}/pay`, { token: tokens.elif, body: { method: 'WALLET' } });
  let tk = r.data.order.tickets[0];
  const all = (await api('GET', '/tickets', { token: tokens.elif })).data.tickets;
  tk = all.find((x) => x.order_id === r.data.order.order_id);
  r = await api('POST', `/tickets/${tk.ticket_id}/refund`, { token: tokens.elif });
  assert.equal(r.status, 200);
  assert.equal(r.data.rate, 0.9);
  assert.equal(r.data.amount, 1665);
  // Aegean Waves (15 days) -> 50 %
  const g3 = await tierOf(3, 'General');
  r = await api('POST', '/orders', { token: tokens.elif, body: { festival_id: 3, items: [{ tier_id: g3.tier_id, quantity: 1 }] } });
  await api('POST', `/orders/${r.data.order.order_id}/pay`, { token: tokens.elif, body: { method: 'WALLET' } });
  tk = (await api('GET', '/tickets', { token: tokens.elif })).data.tickets.find((x) => x.order_id === r.data.order.order_id);
  r = await api('POST', `/tickets/${tk.ticket_id}/refund`, { token: tokens.elif });
  assert.equal(r.data.rate, 0.5);
  assert.equal(r.data.amount, 475);
  // Antalya (5 days) -> 0 %, refused
  tk = (await api('GET', '/tickets', { token: tokens.elif })).data.tickets.find((x) => x.festival_name === 'Antalya Sunset Sessions');
  r = await api('POST', `/tickets/${tk.ticket_id}/refund`, { token: tokens.elif });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /less than 7 days/);
});

test('rule 8: anti-passback at the gate', async () => {
  const t = (await api('GET', '/tickets', { token: tokens.can })).data.tickets.find((x) => x.festival_name === 'Bosphorus Beats');
  const qr = (await api('GET', `/tickets/${t.ticket_id}`, { token: tokens.can })).data.ticket.qr_token;
  const scan = (direction, gate = 'NORTH-1') => api('POST', '/scans', { token: tokens.gate, body: { qr_token: qr, gate_code: gate, direction } });
  assert.equal((await scan('OUT')).data.result, 'REJECTED_INVALID');
  assert.equal((await scan('IN')).data.result, 'ACCEPTED');
  assert.equal((await scan('IN', 'SOUTH-1')).data.result, 'REJECTED_DUPLICATE');
  assert.equal((await scan('OUT')).data.result, 'ACCEPTED');
  // two gates at the same instant: exactly one accepted
  const both = await Promise.all([scan('IN', 'NORTH-1'), scan('IN', 'NORTH-2')]);
  assert.deepEqual(both.map((b) => b.data.result).sort(), ['ACCEPTED', 'REJECTED_DUPLICATE']);
  // checked-in tickets cannot be refunded
  const r = await api('POST', `/tickets/${t.ticket_id}/refund`, { token: tokens.ayse });
  assert.equal(r.status, 409);
  // not-live festival
  const t1 = (await api('GET', '/tickets', { token: tokens.can })).data.tickets.find((x) => x.festival_name === 'Istanbul Sound Festival' && x.status === 'VALID');
  const qr1 = (await api('GET', `/tickets/${t1.ticket_id}`, { token: tokens.can })).data.ticket.qr_token;
  assert.equal((await api('POST', '/scans', { token: tokens.gate, body: { qr_token: qr1, gate_code: 'N-1', direction: 'IN' } })).data.result, 'REJECTED_NOT_LIVE');
  assert.equal((await api('POST', '/scans', { token: tokens.ayse, body: { qr_token: qr1, gate_code: 'N-1', direction: 'IN' } })).status, 403);
});

test('rules 9-11: vendor eligibility, one approved per stall, max 2, fees, cancellation', async () => {
  const stalls = (await api('GET', '/festivals/1/stalls', { token: tokens.vendor2 })).data.stalls;
  const free = stalls.filter((s) => !s.approved_vendor);
  const vendors2 = (await api('GET', '/vendors/mine', { token: tokens.vendor2 })).data.vendors;
  const late = vendors2.find((v) => v.tax_number === '4567890123'); // hygiene expires in 20 days
  let r = await api('POST', '/allocations', { token: tokens.vendor2, body: { vendor_id: late.vendor_id, stall_id: free[0].stall_id } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /rule 9/);
  const pending = vendors2.find((v) => v.status === 'PENDING_REVIEW');
  r = await api('POST', '/allocations', { token: tokens.vendor2, body: { vendor_id: pending.vendor_id, stall_id: free[0].stall_id } });
  assert.equal(r.status, 409);
  // taken stall
  const taken = stalls.find((s) => s.approved_vendor);
  const merch = vendors2.find((v) => v.category === 'MERCH');
  r = await api('POST', '/allocations', { token: tokens.vendor2, body: { vendor_id: merch.vendor_id, stall_id: taken.stall_id } });
  assert.equal(r.status, 409);
  // merch applies for 3 free stalls; organizer approves 2, the 3rd hits rule 10
  const ids = [];
  for (const s of free.filter((x) => x.open_applications === 0).slice(0, 3)) {
    r = await api('POST', '/allocations', { token: tokens.vendor2, body: { vendor_id: merch.vendor_id, stall_id: s.stall_id } });
    assert.equal(r.status, 201);
    ids.push(r.data.allocation.allocation_id);
  }
  assert.equal((await api('POST', `/allocations/${ids[0]}/approve`, { token: tokens.organizer2, body: {} })).status, 403, 'not their festival');
  assert.equal((await api('POST', `/allocations/${ids[0]}/approve`, { token: tokens.organizer, body: { agreed_fee: 10000 } })).status, 200);
  assert.equal((await api('POST', `/allocations/${ids[1]}/approve`, { token: tokens.organizer, body: {} })).status, 200);
  r = await api('POST', `/allocations/${ids[2]}/approve`, { token: tokens.organizer, body: {} });
  assert.equal(r.status, 409);
  // pay fee, then cancel early (> 21 days) -> full refund
  r = await api('POST', `/allocations/${ids[0]}/pay`, { token: tokens.vendor2, body: { method: 'BANK_TRANSFER' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.amount, 10000);
  r = await api('POST', `/allocations/${ids[0]}/cancel`, { token: tokens.vendor2 });
  assert.equal(r.data.refund, 10000);
  // overdue fee job cancels unpaid approvals after 7 days
  const db = require('../src/db');
  await db.query('UPDATE StallAllocations SET approved_at = NOW() - INTERVAL 8 DAY WHERE allocation_id = ?', [ids[1]]);
  const jobs = require('../src/jobs');
  await jobs.runOnce({ log() {}, error() {} });
  const a = await db.one('SELECT status FROM StallAllocations WHERE allocation_id = ?', [ids[1]]);
  assert.equal(a.status, 'CANCELLED');
});

test('rule 11: late vendor cancellation forfeits 50%', async () => {
  // Aegean Waves starts in 15 days
  const stalls = (await api('GET', '/festivals/3/stalls', { token: tokens.vendor })).data.stalls;
  const v = (await api('GET', '/vendors/mine', { token: tokens.vendor })).data.vendors.find((x) => x.category === 'BEVERAGE');
  const s = stalls.find((x) => !x.approved_vendor && x.stall_code === 'E-01');
  let r = await api('POST', '/allocations', { token: tokens.vendor, body: { vendor_id: v.vendor_id, stall_id: s.stall_id } });
  const aid = r.data.allocation.allocation_id;
  await api('POST', `/allocations/${aid}/approve`, { token: tokens.organizer, body: {} });
  await api('POST', `/allocations/${aid}/pay`, { token: tokens.vendor, body: { method: 'CARD', card_number: '5555444433331111' } });
  r = await api('POST', `/allocations/${aid}/cancel`, { token: tokens.vendor });
  assert.equal(r.data.rate, 0.5);
  assert.equal(r.data.refund, 3250);
});

test('rule 12: festival state machine and price freeze', async () => {
  let r = await api('POST', '/festivals', { token: tokens.organizer, body: { name: 'Test Fest', venue_name: 'Park', city: 'Bursa', start_date: '2030-06-01', end_date: '2030-06-02', daily_capacity: 100 } });
  assert.equal(r.status, 201);
  const fid = r.data.festival_id;
  assert.equal((await api('POST', `/festivals/${fid}/status`, { token: tokens.organizer, body: { status: 'ON_SALE' } })).status, 409, 'needs a tier');
  r = await api('POST', `/festivals/${fid}/tiers`, { token: tokens.organizer, body: { tier_name: 'GA', price: 100, quota: 150, sale_start: '2026-01-01 10:00', sale_end: '2030-05-30 10:00' } });
  assert.equal(r.status, 409, 'quota > capacity');
  r = await api('POST', `/festivals/${fid}/tiers`, { token: tokens.organizer, body: { tier_name: 'GA', price: 100, quota: 80, sale_start: '2026-01-01 10:00', sale_end: '2030-05-30 10:00' } });
  const tierId = r.data.tier_id;
  assert.equal((await api('POST', `/festivals/${fid}/status`, { token: tokens.organizer, body: { status: 'COMPLETED' } })).status, 409);
  assert.equal((await api('POST', `/festivals/${fid}/status`, { token: tokens.organizer, body: { status: 'ON_SALE' } })).status, 200);
  r = await api('POST', '/orders', { token: tokens.can, body: { festival_id: fid, items: [{ tier_id: tierId, quantity: 1 }] } });
  assert.equal(r.status, 201);
  r = await api('PUT', `/festivals/${fid}/tiers/${tierId}`, { token: tokens.organizer, body: { tier_name: 'GA', price: 200, quota: 80, sale_start: '2026-01-01 10:00', sale_end: '2030-05-30 10:00' } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /frozen/);
});

test('rule 7 + 13: cancelling a festival refunds 100% and never over-refunds', async () => {
  const db = require('../src/db');
  const before = await db.one("SELECT COUNT(*) AS n FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = 3 AND tk.status IN ('VALID','CHECKED_IN')");
  assert.ok(before.n > 0);
  const r = await api('POST', '/festivals/3/status', { token: tokens.organizer, body: { status: 'CANCELLED' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.summary.orders_refunded > 0);
  const live = await db.one("SELECT COUNT(*) AS n FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE t.festival_id = 3 AND tk.status IN ('VALID','CHECKED_IN')");
  assert.equal(live.n, 0);
  const over = await db.one('SELECT COUNT(*) AS n FROM v_order_totals WHERE refunded_amount > captured_amount');
  assert.equal(over.n, 0);
  // a direct over-refund is stopped by the trigger
  const o = await db.one("SELECT order_id FROM Orders WHERE festival_id = 1 AND status = 'PAID' LIMIT 1");
  await assert.rejects(db.query("INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref) VALUES (?, 'REFUND', 99999, 'CARD', 'CAPTURED', 'TEST-OVER')", [o.order_id]), /rule 13/);
  // exclusive arc
  await assert.rejects(db.query("INSERT INTO Payments (order_id, allocation_id, payment_type, amount, method, status, provider_ref) VALUES (?, 1, 'CHARGE', 1, 'CARD', 'CAPTURED', 'TEST-ARC')", [o.order_id]));
});

test('webhook is idempotent (case 5)', async () => {
  const gen = await tierOf(1, 'Early Bird');
  const r = await api('POST', '/orders', { token: tokens.ayse, body: { festival_id: 1, items: [{ tier_id: gen.tier_id, quantity: 1 }] } });
  const body = { provider_ref: 'PSP-TEST-123', order_id: r.data.order.order_id, amount: 1250, method: 'CARD', status: 'CAPTURED' };
  const hook = (secret) => fetch(`${base}/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify(body) }).then((x) => x.json().then((d) => ({ status: x.status, d })));
  assert.equal((await hook('wrong')).status, 401);
  const first = await hook(require('../src/config').webhookSecret);
  assert.equal(first.d.order_paid, true);
  const second = await hook(require('../src/config').webhookSecret);
  assert.equal(second.d.duplicate, true);
});

test('admin: organizers manage staff accounts, attendees cannot', async () => {
  let r = await api('POST', '/admin/users', { token: tokens.organizer, body: { email: 'gate3@festpass.com', password: 'Secret123', full_name: 'Gate Three', date_of_birth: '1995-01-01', role: 'GATE_STAFF' } });
  assert.equal(r.status, 201);
  assert.equal((await api('POST', '/admin/users', { token: tokens.auditor, body: { email: 'x@festpass.com', password: 'Secret123', full_name: 'X Y', date_of_birth: '1995-01-01', role: 'GATE_STAFF' } })).status, 403);
  r = await api('PATCH', `/admin/users/${r.data.user.user_id}/status`, { token: tokens.organizer, body: { account_status: 'SUSPENDED' } });
  assert.equal(r.status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { email: 'gate3@festpass.com', password: 'Secret123' } })).status, 401);
  assert.equal((await api('GET', '/admin/users', { token: tokens.ayse })).status, 403);
});
