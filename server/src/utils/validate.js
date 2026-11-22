const { badRequest } = require('./errors');

/** Express middleware: validates req[part] against a zod schema and replaces it with the parsed value. */
const validate = (schema, part = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[part] ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(badRequest(issues.map((i) => (i.field ? `${i.field}: ${i.message}` : i.message)).join('; '), issues));
  }
  req[part === 'query' ? 'validQuery' : part] = result.data;
  return next();
};

/** Wrap an async route handler so rejected promises reach the error handler. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid id');
  return n;
};

const toCsv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
};

module.exports = { validate, ah, id, toCsv };
