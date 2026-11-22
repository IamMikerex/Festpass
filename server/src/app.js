const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./db');
const { fromDbError } = require('./utils/errors');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: config.corsOrigin, credentials: false }));
app.use(express.json({ limit: '100kb' }));
if (config.env !== 'test') app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (_req, res) => {
  const r = await db.one('SELECT NOW() AS db_time, VERSION() AS version');
  res.json({ ok: true, ...r });
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

// In production the built React app is served from the same origin.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const mapped = fromDbError(err);
  if (mapped) return res.status(mapped.status).json({ error: mapped.message, details: mapped.details });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on our side' });
});

module.exports = app;
