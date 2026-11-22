import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import { label } from '../lib/format';

const TONES = {
  // festival
  DRAFT: 'plain', ON_SALE: 'green', LIVE: 'live', COMPLETED: 'blue', CANCELLED: 'red',
  // orders
  PENDING: 'amber', PAID: 'green', EXPIRED: 'plain', REFUNDED: 'purple',
  // tickets
  VALID: 'green', CHECKED_IN: 'blue', VOID: 'plain',
  // payments
  CHARGE: 'blue', REFUND: 'purple', CAPTURED: 'green', AUTHORIZED: 'amber', FAILED: 'red',
  // vendors / allocations
  PENDING_REVIEW: 'amber', ACTIVE: 'green', BLACKLISTED: 'red', APPLIED: 'amber', APPROVED: 'green', REJECTED: 'red',
  // scans
  ACCEPTED: 'green', REJECTED_DUPLICATE: 'amber', REJECTED_INVALID: 'red', REJECTED_NOT_LIVE: 'red',
  IN: 'blue', OUT: 'purple',
  // users
  SUSPENDED: 'amber', DELETED: 'red',
  ATTENDEE: 'plain', ORGANIZER: 'purple', VENDOR_MANAGER: 'pink', GATE_STAFF: 'blue', AUDITOR: 'amber',
};

export function Badge({ value, tone, children, title }) {
  const t = tone || TONES[value] || 'plain';
  return <span className={`badge ${t}`} title={title}>{children || label(value)}</span>;
}

export function Loading({ label: text }) {
  return <div className="loading"><div className="stack-sm center"><div className="spinner" style={{ margin: '0 auto' }} />{text && <span className="muted small">{text}</span>}</div></div>;
}

export function Empty({ icon: Icon = Info, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={26} /></div>
      <h3>{title}</h3>
      {children && <p className="small">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({ kind = 'info', children }) {
  const Icon = { error: AlertCircle, success: CheckCircle2, warning: AlertTriangle, info: Info }[kind];
  return <div className={`alert ${kind}`}><Icon size={17} /><div>{children}</div></div>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card card-pad">
      <Alert kind="error">{error?.message || 'Something went wrong'}</Alert>
      {onRetry && <button className="btn btn-outline btn-sm mt-2" onClick={() => onRetry()}>Try again</button>}
    </div>
  );
}

export function Stat({ icon: Icon, tone = '', label: l, value, sub }) {
  return (
    <div className="card stat">
      {Icon && <div className={`stat-icon ${tone}`}><Icon size={20} /></div>}
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{l}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function Field({ label: l, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {l && <label>{l}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** In-app confirmation dialog (no browser confirm()). */
export function Confirm({ title, children, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => {
    setBusy(true);
    try { await onConfirm(); onClose(); } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose} disabled={busy}>Keep it</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={go} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
    </>}>
      {children}
    </Modal>
  );
}

const ToastContext = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((kind, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const api = { success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" className={`tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon && <t.icon size={16} />}{t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max, tone }) {
  const p = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className={`progress ${tone || ''}`}><span style={{ width: `${p}%` }} /></div>;
}
