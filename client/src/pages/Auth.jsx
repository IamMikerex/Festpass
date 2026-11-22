import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Ticket, Store } from 'lucide-react';
import { useAuth, HOME_BY_ROLE } from '../lib/auth';
import { Alert, Field } from '../components/ui';
import FestivalArt from '../components/FestivalArt';
import { scenePhoto } from '../lib/media';

const DEMO = [
  { email: 'ayse@festpass.com', role: 'Attendee', name: 'Ayse' },
  { email: 'organizer@festpass.com', role: 'Organizer', name: 'Selin' },
  { email: 'vendor@festpass.com', role: 'Vendor manager', name: 'Murat' },
  { email: 'gate@festpass.com', role: 'Gate staff', name: 'Burak' },
  { email: 'auditor@festpass.com', role: 'Finance auditor', name: 'Hakan' },
  { email: 'can@festpass.com', role: 'Attendee', name: 'Can' },
];

function AuthArt({ title, text, art = 1, scene = 'crowd' }) {
  return (
    <div className="auth-art">
      <FestivalArt id={art} name={title} photo={scenePhoto(scene, 1200)} eager />
      <span className="chip"><Ticket size={13} /> FestPass</span>
      <h2 className="mt-2">{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const u = await login(email, password);
      nav(loc.state?.from || HOME_BY_ROLE[u.role] || '/', { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap card" style={{ overflow: 'hidden', minHeight: 600 }}>
      <AuthArt title="Welcome back to the front row." text="Your tickets, transfers, stall applications and gate tools are one sign-in away." />
      <div className="auth-form">
        <form className="auth-card stack" onSubmit={submit}>
          <div><h1>Sign in</h1><p className="muted mt-1">New here? <Link to="/register">Create an account</Link></p></div>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Email"><div className="input-icon"><Mail size={16} /><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div></Field>
          <Field label="Password"><div className="input-icon"><Lock size={16} /><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div></Field>
          <button className="btn btn-grad btn-lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="divider" />
          <div>
            <p className="small bold mb-1">Demo accounts <span className="muted" style={{ fontWeight: 400 }}>(password Password123!)</span></p>
            <div className="demo-accounts">
              {DEMO.map((d) => (
                <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPassword('Password123!'); }}>
                  <b>{d.role}</b>{d.email}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '', date_of_birth: '', role: params.get('role') === 'VENDOR_MANAGER' ? 'VENDOR_MANAGER' : 'ATTENDEE' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const u = await register(form);
      nav(HOME_BY_ROLE[u.role], { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap card" style={{ overflow: 'hidden', minHeight: 640 }}>
      <AuthArt art={4} scene="dj" title="One account for every festival." text="Fans buy and manage named tickets. Vendors register their business and apply for stalls. Staff accounts are created by organizers." />
      <div className="auth-form">
        <form className="auth-card stack" onSubmit={submit}>
          <div><h1>Create account</h1><p className="muted mt-1">Already registered? <Link to="/login">Sign in</Link></p></div>
          <div className="segmented">
            <button type="button" className={form.role === 'ATTENDEE' ? 'on' : ''} onClick={() => setForm((f) => ({ ...f, role: 'ATTENDEE' }))}><Ticket size={14} style={{ verticalAlign: -2, marginRight: 6 }} />I'm a fan</button>
            <button type="button" className={form.role === 'VENDOR_MANAGER' ? 'on' : ''} onClick={() => setForm((f) => ({ ...f, role: 'VENDOR_MANAGER' }))}><Store size={14} style={{ verticalAlign: -2, marginRight: 6 }} />I'm a vendor</button>
          </div>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Full name"><input className="input" required value={form.full_name} onChange={set('full_name')} /></Field>
          <Field label="Email"><input className="input" type="email" required value={form.email} onChange={set('email')} /></Field>
          <div className="form-grid">
            <Field label="Date of birth" hint="Used for festival age limits"><input className="input" type="date" required value={form.date_of_birth} onChange={set('date_of_birth')} /></Field>
            <Field label="Phone (optional)"><input className="input" type="tel" placeholder="+90 5xx xxx xx xx" value={form.phone} onChange={set('phone')} /></Field>
          </div>
          <Field label="Password" hint="At least 8 characters with a letter and a number"><input className="input" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} /></Field>
          <button className="btn btn-grad btn-lg" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
      </div>
    </div>
  );
}
