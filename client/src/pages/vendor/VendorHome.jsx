import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Store, Plus, Pencil, FileCheck2, AlertTriangle, MapPinned } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { Alert, Badge, Empty, ErrorState, Field, Loading, Modal, useToast } from '../../components/ui';
import { date, label, today } from '../../lib/format';

const EMPTY = { legal_name: '', tax_number: '', category: 'FOOD', license_expiry: '', hygiene_cert_expiry: '' };

export function VendorForm({ vendor, onClose, onSaved }) {
  const [f, setF] = useState(vendor ? { ...EMPTY, ...vendor, hygiene_cert_expiry: vendor.hygiene_cert_expiry || '' } : EMPTY);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const needsHygiene = ['FOOD', 'BEVERAGE'].includes(f.category);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const body = { legal_name: f.legal_name, tax_number: f.tax_number, category: f.category, license_expiry: f.license_expiry, hygiene_cert_expiry: f.hygiene_cert_expiry || null };
    try {
      if (vendor) await api.put(`/vendors/${vendor.vendor_id}`, body); else await api.post('/vendors', body);
      toast.success(vendor ? 'Business updated' : 'Business registered. An organizer will review it.');
      onSaved();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={vendor ? 'Edit business' : 'Register a business'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {err && <Alert kind="error">{err}</Alert>}
        <Field label="Legal name"><input className="input" required value={f.legal_name} onChange={set('legal_name')} /></Field>
        <div className="form-grid">
          <Field label="Tax number (VKN)" hint="10 digits"><input className="input mono" required inputMode="numeric" maxLength={10} value={f.tax_number} onChange={(e) => setF({ ...f, tax_number: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Category">
            <select className="select" value={f.category} onChange={set('category')}>
              {['FOOD', 'BEVERAGE', 'MERCH', 'SERVICE'].map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </select>
          </Field>
          <Field label="Business license expires"><input className="input" type="date" required value={f.license_expiry} onChange={set('license_expiry')} /></Field>
          <Field label={`Hygiene certificate expires${needsHygiene ? '' : ' (optional)'}`}><input className="input" type="date" required={needsHygiene} value={f.hygiene_cert_expiry} onChange={set('hygiene_cert_expiry')} /></Field>
        </div>
        <Alert>To apply for a stall, your license{needsHygiene ? ' and hygiene certificate' : ''} must stay valid until the festival's last day, and an organizer must have activated your business.</Alert>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function VendorHome() {
  const { data, loading, error, reload } = useFetch(() => api.get('/vendors/mine'), []);
  const [edit, setEdit] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const t = today();
  return (
    <>
      <section className="portal-hero">
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <div><span className="eyebrow">Vendor portal</span><h1 className="mt-1">My businesses</h1><p className="muted mt-1">Register each food truck, bar or brand you manage, then apply for stalls.</p></div>
          <div className="row">
            <Link to="/vendor/stalls" className="btn btn-outline"><MapPinned size={16} />Find a stall</Link>
            <button className="btn btn-grad" onClick={() => setEdit({})}><Plus size={16} />Register business</button>
          </div>
        </div>
        <div className="portal-steps">
          <div><b>1</b>Register your business</div>
          <div><b>2</b>Organizer verifies permits</div>
          <div><b>3</b>Apply for a stall on the map</div>
          <div><b>4</b>Pay the fee within 7 days</div>
        </div>
      </section>
      {data.vendors.length === 0 ? (
        <div className="card"><Empty icon={Store} title="No businesses yet" action={<button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />Register business</button>}>
          Add your company with its tax number and permit expiry dates.
        </Empty></div>
      ) : (
        <div className="grid grid-auto">
          {data.vendors.map((v) => {
            const licExp = v.license_expiry < t;
            const hygExp = v.hygiene_cert_expiry && v.hygiene_cert_expiry < t;
            return (
              <div key={v.vendor_id} className="card">
                <div className="card-head"><h3>{v.legal_name}</h3><Badge value={v.status} /></div>
                <div className="card-body stack-sm">
                  <div className="row small"><Badge tone="pink" value={v.category} /><span className="mono muted">VKN {v.tax_number}</span></div>
                  <div className="small row"><FileCheck2 size={15} className="muted" />License until <b className={licExp ? '' : ''} style={{ color: licExp ? 'var(--danger)' : undefined }}>{date(v.license_expiry)}</b></div>
                  <div className="small row"><FileCheck2 size={15} className="muted" />Hygiene cert. {v.hygiene_cert_expiry ? <b style={{ color: hygExp ? 'var(--danger)' : undefined }}>until {date(v.hygiene_cert_expiry)}</b> : <span className="muted">not provided</span>}</div>
                  <div className="small muted">{v.approved_stalls} approved stall(s) · {v.open_applications} open application(s)</div>
                  {v.status === 'PENDING_REVIEW' && <Alert kind="warning">Waiting for an organizer to verify this business.</Alert>}
                  {v.status === 'BLACKLISTED' && <Alert kind="error"><AlertTriangle size={14} /> This business can't apply for stalls.</Alert>}
                </div>
                <div className="card-foot row-between">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit(v)} disabled={v.status === 'BLACKLISTED'}><Pencil size={14} />Edit</button>
                  {v.status === 'ACTIVE' && <Link to="/vendor/stalls" className="btn btn-primary btn-sm">Apply for a stall</Link>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && <VendorForm vendor={edit.vendor_id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(true); }} />}
    </>
  );
}
