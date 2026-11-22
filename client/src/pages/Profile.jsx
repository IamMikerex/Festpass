import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Field, useToast } from '../components/ui';
import { date } from '../lib/format';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: user.full_name, phone: user.phone || '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [err, setErr] = useState(null);
  const [pwErr, setPwErr] = useState(null);

  const save = async (e) => {
    e.preventDefault(); setErr(null);
    try { const r = await api.put('/auth/me', form); setUser(r.user); toast.success('Profile saved'); } catch (x) { setErr(x.message); }
  };
  const changePw = async (e) => {
    e.preventDefault(); setPwErr(null);
    try { await api.put('/auth/password', pw); setPw({ current_password: '', new_password: '' }); toast.success('Password changed'); } catch (x) { setPwErr(x.message); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Profile</h1><p>{user.email} · <Badge value={user.role} /></p></div></div>
      <div className="grid grid-2">
        <form className="card card-pad stack" onSubmit={save}>
          <h2>Personal details</h2>
          {err && <Alert kind="error">{err}</Alert>}
          <Field label="Full name"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Date of birth" hint="Contact an organizer to correct your date of birth (it decides age limits)."><input className="input" value={date(user.date_of_birth)} disabled /></Field>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save</button>
        </form>
        <form className="card card-pad stack" onSubmit={changePw}>
          <h2>Change password</h2>
          {pwErr && <Alert kind="error">{pwErr}</Alert>}
          <Field label="Current password"><input className="input" type="password" required value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
          <Field label="New password" hint="At least 8 characters with a letter and a number"><input className="input" type="password" required value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Update password</button>
        </form>
      </div>
    </>
  );
}
