/**
 * Minimal structured logger (no dependency).
 * Production (or LOG_FORMAT=json): one JSON object per line, ready for docker logs / journald / a log shipper.
 * Development: short human-readable lines.
 * LOG_LEVEL: error | warn | info | debug (default info).
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const env = process.env.NODE_ENV || 'development';
const json = (process.env.LOG_FORMAT || (env === 'production' ? 'json' : 'pretty')) === 'json';
const threshold = LEVELS[process.env.LOG_LEVEL] ?? (env === 'test' ? LEVELS.warn : LEVELS.info);

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return { name: err.name, message: err.message, code: err.code, sqlState: err.sqlState, stack: err.stack };
}

function write(level, msg, fields = {}) {
  if (LEVELS[level] > threshold) return;
  const data = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, k === 'err' ? serializeError(v) : v]));
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (json) {
    out.write(`${JSON.stringify({ time: new Date().toISOString(), level, service: 'festpass-api', msg, ...data })}\n`);
  } else {
    const extra = Object.entries(data).filter(([k]) => k !== 'err').map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
    out.write(`[${level}] ${msg}${extra ? ` ${extra}` : ''}\n`);
    if (data.err && data.err.stack) out.write(`${data.err.stack}\n`);
  }
}

module.exports = {
  error: (msg, f) => write('error', msg, f),
  warn: (msg, f) => write('warn', msg, f),
  info: (msg, f) => write('info', msg, f),
  debug: (msg, f) => write('debug', msg, f),
  json,
};
