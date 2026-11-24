import { useState } from 'react';
import { UserPlus, Search, Users } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { useAuth } from '../../lib/auth';
import { Alert, Badge, Confirm, Empty, ErrorState, Field, Loading, Modal, useToast } from '../../components/ui';
import { date, label } from '../../lib/format';

const ROLES = ['ATTENDEE', 'ORGANIZER', 'VENDOR_MANAGER', 'GATE_STAFF', 'AUDITOR'];

function NewUser({ onClose, onDone }) {
  const [f, setF] = useState({ full_name: '', email: '', password: '', date_of_birth: '', phone: '', role: 'GATE_STAFF' });
  const [err, setErr] = useState(null);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/admin/users', f); toast.success(`${label(f.role)} account created`); onDone(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title="Create staff account" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {err && <Alert kind="error">{err}</Alert>}
        <Field label="Role"><select className="select" value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></Field>
        <div className="form-grid">
          <Field label="Full name"><input className="input" required value={f.full_name} onChange={set('full_name')} /></Field>
          <Field label="Email"><input className="input" type="email" required value={f.email} onChange={set('email')} /></Field>
          <Field label="Date of birth"><input className="input" type="date" required value={f.date_of_birth} onChange={set('date_of_birth')} /></Field>
          <Field label="Phone (optional)"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Temporary password" className="full" hint="8+ characters with a letter and a number"><input className="input" required value={f.password} onChange={set('password')} /></Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary">Create account</button></div>
      </form>
    </Modal>
  );
}

export default function UsersAdmin() {
  const { user } = useAuth();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useFetch(() => api.get(`/admin/users${qs({ role, q })}`), [role, q]);
  const [creating, setCreating] = useState(false);
  const [change, setChange] = useState(null);
  const toast = useToast();
  return (
    <>
      <div className="page-head">
        <div><h1>Users</h1><p>Create gate staff, auditors and fellow organizers. Accounts are never hard-deleted.</p></div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><UserPlus size={16} />Create account</button>
      </div>
      <div className="row mb-2">
        <div className="input-icon" style={{ flex: '1 1 260px', maxWidth: 360 }}><Search size={16} /><input className="input" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="select" style={{ width: 'auto', minWidth: 200 }} value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select>
      </div>
      <div className="card">
        {loading ? <Loading /> : error ? <ErrorState error={error} /> : data.users.length === 0 ? <Empty icon={Users} title="No users found" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Born</th><th>Joined</th><th>Status</th><th /></tr></thead>
            <tbody>{data.users.map((u) => (
              <tr key={u.user_id}>
                <td><b>{u.full_name}</b><div className="tiny muted">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></td>
                <td><Badge value={u.role} /></td>
                <td className="small">{date(u.date_of_birth)}</td>
                <td className="small">{date(u.created_at)}</td>
                <td><Badge value={u.account_status} /></td>
                <td className="right nowrap">{u.user_id !== user.user_id && u.account_status !== 'DELETED' && <>
                  {u.account_status === 'ACTIVE'
                    ? <button className="btn btn-ghost btn-sm" onClick={() => setChange({ u, s: 'SUSPENDED' })}>Suspend</button>
                    : <button className="btn btn-ghost btn-sm" onClick={() => setChange({ u, s: 'ACTIVE' })}>Reactivate</button>}
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setChange({ u, s: 'DELETED' })}>Delete</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {creating && <NewUser onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(true); }} />}
      {change && <Confirm title={`${label(change.s === 'DELETED' ? 'delete' : change.s === 'ACTIVE' ? 'reactivate' : 'suspend')} ${change.u.full_name}?`} danger={change.s !== 'ACTIVE'} confirmLabel="Confirm" onClose={() => setChange(null)}
        onConfirm={async () => { await api.patch(`/admin/users/${change.u.user_id}/status`, { account_status: change.s }); toast.success('Account updated'); reload(true); }}>
        <p>{change.s === 'DELETED' ? 'The account is closed and its name, email and phone are anonymised (KVKK). Orders, payments and scans stay for the audit trail. This cannot be undone.' : change.s === 'SUSPENDED' ? 'The user is signed out and cannot sign in until reactivated.' : 'The user can sign in again.'}</p>
      </Confirm>}
    </>
  );
}
