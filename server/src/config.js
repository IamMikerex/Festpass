require('dotenv').config();

const required = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
};

const config = {
  port: Number(process.env.PORT || 4000),
  env: process.env.NODE_ENV || 'development',
  db: {
    host: required('DB_HOST', '127.0.0.1'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER', 'festpass'),
    password: required('DB_PASSWORD', 'festpass'),
    database: required('DB_NAME', 'festpass'),
    timezone: process.env.DB_TIMEZONE || '+03:00',
  },
  jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'dev-only-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  currency: 'TRY',
  jobsIntervalMs: Number(process.env.JOBS_INTERVAL_MS || 30000),
};

module.exports = config;
