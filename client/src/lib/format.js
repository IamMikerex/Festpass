const moneyFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'TRY', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 });
const moneyShort = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'TRY', currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat('en-US');

export const money = (n) => moneyFmt.format(Number(n || 0));
export const moneyCompact = (n) => moneyShort.format(Number(n || 0));
export const num = (n) => numFmt.format(Number(n || 0));

// The API sends "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS" in festival local time.
export const parse = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);
export const date = (s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (s ? parse(s).toLocaleDateString('en-GB', opts) : '—');
export const dateTime = (s) => (s ? parse(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const time = (s) => (s ? parse(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export const dateRange = (a, b) => {
  if (!a) return '';
  const da = parse(a);
  const db = parse(b || a);
  if (a === b) return date(a);
  const sameMonth = da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear();
  return sameMonth
    ? `${da.getDate()}–${db.getDate()} ${db.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
    : `${date(a, { day: 'numeric', month: 'short' })} – ${date(b)}`;
};
export const label = (s) => (s ? String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');
export const pct = (a, b) => (b ? Math.round((Number(a) / Number(b)) * 100) : 0);
export const today = () => new Date().toISOString().slice(0, 10);
