const config = require('./config');
const orders = require('./services/orders');
const vendors = require('./services/vendors');
const festivals = require('./services/festivals');
const logger = require('./utils/logger');

/** Scheduled jobs from Part 2 a: order expiry (rule 3), fee deadline (rule 11), festival lifecycle (rule 12). */
const defaultLog = { log: (m, d) => logger.info(m, { result: d }), error: (m, e) => logger.error(m, { detail: e }) };

async function runOnce(log = defaultLog) {
  const out = {};
  try { out.expiredOrders = await orders.expireStaleOrders(); } catch (e) { log.error('[jobs] order expiry failed:', e.message); }
  try { out.cancelledAllocations = await vendors.cancelOverdueAllocations(); } catch (e) { log.error('[jobs] fee deadline failed:', e.message); }
  try { out.festivalTransitions = await festivals.advanceLifecycle(); } catch (e) { log.error('[jobs] lifecycle failed:', e.message); }
  const changed = Object.values(out).some((n) => n > 0);
  if (changed) log.log('[jobs]', JSON.stringify(out));
  return out;
}

let timer = null;
function start() {
  runOnce();
  timer = setInterval(() => runOnce(), config.jobsIntervalMs);
  timer.unref();
  return timer;
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, runOnce };
