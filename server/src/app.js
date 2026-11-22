const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const http = require('http');
const config = require('./config');
const db = require('./db');
const crypto = require('crypto');
const { fromDbError } = require('./utils/errors');
const log = require('./utils/logger');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: config.corsOrigin, credentials: false }));
app.use(express.json({ limit: '100kb' }));

// Every request gets an id (kept from a proxy's X-Request-Id), echoed in the response and in logs.
app.use((req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
});

// Access log: JSON lines in production, morgan's short format in development, silent in tests.
if (log.json) {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/api/health') return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const fields = { request_id: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms), user_id: req.user && req.user.user_id, ip: req.ip };
      if (res.statusCode >= 500) log.error('request', fields); else log.info('request', fields);
    });
    next();
  });
} else if (config.env !== 'test') {
  app.use(morgan('dev'));
}

// Liveness + readiness: 200 when the database answers, 503 when it does not.
app.get('/api/health', async (_req, res) => {
  try {
    const r = await db.one('SELECT NOW() AS db_time, VERSION() AS version');
    res.json({ ok: true, service: 'festpass-api', ...r });
  } catch (err) {
    log.error('Health check: database unreachable', { err });
    res.status(503).json({ ok: false, error: 'Database unreachable' });
  }
});

app.use('/api/auth', require('./routes/auth').router);
app.use('/api/festivals', require('./routes/festivals').router);
app.use('/api/orders', require('./routes/orders').router);
app.use('/api/tickets', require('./routes/tickets').router);
app.use('/api/scans', require('./routes/scans').router);
app.use('/api/vendors', require('./routes/vendors').router);
app.use('/api/allocations', require('./routes/vendors').allocRouter);
app.use('/api/payments', require('./routes/payments').router);
app.use('/api/admin', require('./routes/admin').router);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Single-origin production setup: forward /analytics/* to the FastAPI service.
app.use('/analytics', (req, res) => {
  const target = new URL(req.originalUrl, config.analyticsUrl);
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host, 'x-request-id': req.id }, timeout: 30000 }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Analytics request timed out')));
  upstream.on('error', (err) => {
    log.error('Analytics proxy failed', { request_id: req.id, err });
    if (!res.headersSent) res.status(502).json({ error: 'Analytics service is not reachable', request_id: req.id });
    else res.end();
  });
  req.pipe(upstream);
});

// In production the built React app is served from the same origin.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (config.serveClient && fs.existsSync(clientDist)) {
  // Hashed build assets can be cached for a year; index.html must always be revalidated.
  app.use('/assets', express.static(path.join(clientDist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const mapped = fromDbError(err);
  if (mapped) {
    if (mapped.status >= 500) log.warn('Request failed', { request_id: req.id, status: mapped.status, err });
    return res.status(mapped.status).json({ error: mapped.message, details: mapped.details });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  const dbDown = err.fatal || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(err.code);
  if (dbDown) {
    log.error('Database unavailable', { request_id: req.id, err });
    return res.status(503).json({ error: 'The service is temporarily unavailable, please try again shortly', request_id: req.id });
  }
  log.error('Unhandled error', { request_id: req.id, method: req.method, path: req.originalUrl, err });
  // Never leak internals: the id lets an operator find the stack trace in the logs.
  return res.status(500).json({ error: 'Something went wrong on our side', request_id: req.id });
});

module.exports = app;
