const config = require('./config');
const orders = require('./services/orders');
const vendors = require('./services/vendors');
const festivals = require('./services/festivals');

/** Scheduled jobs from Part 2 a: order expiry (rule 3), fee deadline (rule 11), festival lifecycle (rule 12). */
async function runOnce(log = console) {
  const out = {};
  try { out.expiredOrders = await orders.expireStaleOrders(); } catch (e) { log.error('[jobs] order expiry failed:', e.message); }
  try { out.cancelledAllocations = await vendors.cancelOverdueAllocations(); } catch (e) { log.error('[jobs] fee deadline failed:', e.message); }
  try { out.festivalTransitions = await festivals.advanceLifecycle(); } catch (e) { log.error('[jobs] lifecycle failed:', e.message); }
  const changed = Object.values(out).some((n) => n > 0);
  if (changed) log.log('[jobs]', JSON.stringify(out));
  return out;
}

function start() {
  runOnce();
  const t = setInterval(runOnce, config.jobsIntervalMs);
  t.unref();
  return t;
}

module.exports = { start, runOnce };
