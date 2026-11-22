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
  analyticsUrl: process.env.ANALYTICS_URL || 'http://127.0.0.1:8000',
  currency: 'TRY',
  jobsIntervalMs: Number(process.env.JOBS_INTERVAL_MS || 30000),
  // Run the scheduled jobs in this process. With several API replicas, enable them on one only.
  jobsEnabled: (process.env.JOBS_ENABLED || 'true') !== 'false',
  dbConnectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 15),
  // Serve client/dist from this process (single-origin production). Set to false when a CDN or nginx serves it.
  serveClient: (process.env.SERVE_CLIENT || 'true') !== 'false',
};

// Refuse to start in production with development secrets.
if (config.env === 'production') {
  const problems = [];
  const weak = (v) => !v || v.length < 32 || /change-me|dev-only/i.test(v);
  if (weak(config.jwtSecret)) problems.push('JWT_SECRET must be a random string of at least 32 characters');
  if (weak(config.webhookSecret)) problems.push('PAYMENT_WEBHOOK_SECRET must be a random string of at least 32 characters');
  if (!process.env.CORS_ORIGIN) problems.push('CORS_ORIGIN must list the public URL(s) of the site');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
}

module.exports = config;
