const TOKEN_KEY = 'festpass.token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(base, method, path, body) {
  const token = tokenStore.get();
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach FestPass. Check your connection and try again.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    let msg = (data && (data.error || (typeof data.detail === 'string' ? data.detail : null))) || null;
    if (!msg && res.status >= 502) msg = 'The service is temporarily unavailable. Please try again in a moment.';
    if (!msg) msg = `Request failed (${res.status})`;
    if (data && data.request_id && res.status >= 500) msg += ` (reference ${data.request_id.slice(0, 8)})`;
    throw new ApiError(res.status, msg, data && data.details);
  }
  return data;
}

/** Express core API */
export const api = {
  get: (p) => request('/api', 'GET', p),
  post: (p, b = {}) => request('/api', 'POST', p, b),
  put: (p, b = {}) => request('/api', 'PUT', p, b),
  patch: (p, b = {}) => request('/api', 'PATCH', p, b),
  del: (p) => request('/api', 'DELETE', p),
};

/** FastAPI analytics service */
export const analytics = {
  get: (p) => request('/analytics', 'GET', p),
  async download(path, filename) {
    const token = tokenStore.get();
    const res = await fetch(`/analytics${path}${path.includes('?') ? '&' : '?'}format=csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
