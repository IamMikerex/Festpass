import { useState } from 'react';
import { Store, Check, X, Ban, Search, RotateCcw } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { useAuth } from '../../lib/auth';
import { Badge, Confirm, Empty, ErrorState, Loading, Modal, Field, Alert, Tabs, useToast } from '../../components/ui';
import { date, dateTime, label, money } from '../../lib/format';

function Pending({ reload: reloadVendors }) {
  const { data, loading, error, reload } = useFetch(() => api.get('/allocations/pending'), []);
  const [approve, setApprove] = useState(null);
  const [fee, setFee] = useState('');
  const [err, setErr] = useState(null);
  const [reject, setReject] = useState(null);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  return (
    <div className="card">
      {data.allocations.length === 0 ? <Empty icon={Check} title="All caught up">No stall applications waiting for review.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Applied</th><th>Festival · stall</th><th>Vendor</th><th>Eligibility (rule 9)</th><th className="num">Proposed fee</th><th /></tr></thead>
          <tbody>{data.allocations.map((a) => (
            <tr key={a.allocation_id}>
              <td className="small nowrap">{dateTime(a.applied_at)}</td>
              <td>{a.festival_name}<div className="tiny muted mono">{a.stall_code} · {label(a.zone)}</div></td>
              <td>{a.legal_name}<div className="tiny muted">{label(a.category)} · license {date(a.license_expiry)}</div></td>
              <td className="small">{a.eligible ? <Badge tone="green">Eligible</Badge> : <span style={{ color: 'var(--danger)' }}>{a.problems.join('; ')}</span>}</td>
              <td className="num">{money(a.agreed_fee)}</td>
              <td className="right nowrap">
                <button className="btn btn-success btn-sm" disabled={!a.eligible} onClick={() => { setApprove(a); setFee(a.agreed_fee); setErr(null); }}><Check size={14} />Approve</button>{' '}
                <button className="btn btn-ghost btn-sm" onClick={() => setReject(a)}><X size={14} />Reject</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {approve && (
        <Modal title={`Approve ${approve.legal_name} · ${approve.stall_code}`} onClose={() => setApprove(null)} footer={<>
          <button className="btn btn-outline" onClick={() => setApprove(null)}>Cancel</button>
          <button className="btn btn-success" onClick={async () => { try { await api.post(`/allocations/${approve.allocation_id}/approve`, { agreed_fee: Number(fee) }); toast.success('Approved'); setApprove(null); reload(true); reloadVendors(); } catch (x) { setErr(x.message); } }}><Check size={15} />Approve</button>
        </>}>
          <div className="stack">
            <Field label="Agreed fee (TRY)" hint={`Base fee ${money(approve.base_fee)}. Unpaid approvals are cancelled automatically after 7 days.`}><input className="input" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
            {err && <Alert kind="error">{err}</Alert>}
          </div>
        </Modal>
      )}
      {reject && <Confirm title="Reject application?" danger confirmLabel="Reject" onClose={() => setReject(null)}
        onConfirm={async () => { await api.post(`/allocations/${reject.allocation_id}/reject`); toast.success('Rejected'); reload(true); }}>
        <p>{reject.legal_name} will see the application for {reject.stall_code} as rejected.</p></Confirm>}
    </div>
  );
}

function Registry({ data, reload, canEdit }) {
  const [action, setAction] = useState(null);
  const toast = useToast();
  return (
    <div className="card">
      {data.vendors.length === 0 ? <Empty icon={Store} title="No vendors found" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Vendor</th><th>Category</th><th>Tax no.</th><th>License</th><th>Hygiene cert.</th><th>Manager</th><th>Status</th><th /></tr></thead>
          <tbody>{data.vendors.map((v) => (
            <tr key={v.vendor_id}>
              <td className="bold">{v.legal_name}<div className="tiny muted">{v.approved_stalls} approved stall(s)</div></td>
              <td><Badge tone="pink" value={v.category} /></td>
              <td className="mono small">{v.tax_number}</td>
              <td className="small" style={{ color: v.license_expired ? 'var(--danger)' : undefined }}>{date(v.license_expiry)}{v.license_expired ? ' (expired)' : ''}</td>
              <td className="small" style={{ color: v.hygiene_expired ? 'var(--danger)' : undefined }}>{v.hygiene_cert_expiry ? date(v.hygiene_cert_expiry) : '—'}{v.hygiene_expired ? ' (expired)' : ''}</td>
              <td className="small">{v.manager_name}<div className="tiny muted">{v.manager_email}</div></td>
              <td><Badge value={v.status} /></td>
              <td className="right nowrap">{canEdit && <>
                {v.status !== 'ACTIVE' && v.status !== 'BLACKLISTED' && <button className="btn btn-success btn-sm" onClick={() => setAction({ v, status: 'ACTIVE' })}><Check size={14} />Activate</button>}
                {v.status === 'BLACKLISTED' && <button className="btn btn-ghost btn-sm" onClick={() => setAction({ v, status: 'PENDING_REVIEW' })}><RotateCcw size={14} />Reinstate</button>}
                {v.status !== 'BLACKLISTED' && <button className="btn btn-ghost btn-sm" onClick={() => setAction({ v, status: 'BLACKLISTED' })}><Ban size={14} />Blacklist</button>}
              </>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {action && <Confirm title={`${label(action.status)} ${action.v.legal_name}?`} danger={action.status === 'BLACKLISTED'} confirmLabel={label(action.status)} onClose={() => setAction(null)}
        onConfirm={async () => { await api.post(`/vendors/${action.v.vendor_id}/status`, { status: action.status }); toast.success('Vendor updated'); reload(true); }}>
        <p>{action.status === 'ACTIVE' ? 'Check the tax number and permit dates before activating. Active vendors can apply for stalls.' : action.status === 'BLACKLISTED' ? 'Blacklisted vendors cannot apply, and their open applications are rejected.' : 'The vendor goes back to review.'}</p>
      </Confirm>}
    </div>
  );
}

export default function VendorReview() {
  const { user } = useAuth();
  const isOrg = user.role === 'ORGANIZER';
  const [tab, setTab] = useState(isOrg ? 'pending' : 'registry');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const vendors = useFetch(() => api.get(`/vendors${qs({ status, q })}`), [status, q]);
  return (
    <>
      <div className="page-head"><div><h1>Vendors</h1><p>Verify businesses and permits, then allocate stalls.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        ...(isOrg ? [{ id: 'pending', label: 'Stall applications' }] : []),
        { id: 'registry', label: 'Vendor registry', count: vendors.data?.vendors.length },
      ]} />
      {tab === 'pending' && <Pending reload={() => vendors.reload(true)} />}
      {tab === 'registry' && (
        <div className="stack">
          <div className="row">
            <div className="input-icon" style={{ flex: '1 1 260px', maxWidth: 360 }}><Search size={16} /><input className="input" placeholder="Name or tax number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select className="select" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>{['PENDING_REVIEW', 'ACTIVE', 'BLACKLISTED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          {vendors.loading ? <Loading /> : vendors.error ? <ErrorState error={vendors.error} /> : <Registry data={vendors.data} reload={vendors.reload} canEdit={isOrg} />}
        </div>
      )}
    </>
  );
}
