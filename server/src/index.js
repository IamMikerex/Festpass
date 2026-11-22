const app = require('./app');
const config = require('./config');
const jobs = require('./jobs');
const db = require('./db');
const log = require('./utils/logger');

const server = app.listen(config.port, () => {
  log.info(`FestPass API listening on http://localhost:${config.port}`, { env: config.env, jobs: config.jobsEnabled });
  if (config.jobsEnabled) jobs.start();
});
server.keepAliveTimeout = 65000; // longer than typical load-balancer idle timeouts
server.headersTimeout = 66000;

// Graceful shutdown: stop taking requests, finish the ones in flight, close the DB pool.
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info('Shutting down', { signal });
  jobs.stop();
  server.close(async () => {
    try { await db.pool.end(); } catch (e) { log.warn('DB pool close failed', { err: e }); }
    log.info('Stopped');
    process.exit(0);
  });
  setTimeout(() => { log.error('Forced exit after 10 s'); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('Unhandled promise rejection', { err }));
process.on('uncaughtException', (err) => { log.error('Uncaught exception', { err }); shutdown('uncaughtException'); });
