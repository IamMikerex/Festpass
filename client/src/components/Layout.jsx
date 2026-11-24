import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Ticket, Compass, LayoutDashboard, CalendarDays, Store, ScanLine, Receipt, Users, ShieldCheck,
  LogOut, Menu, X, ClipboardList, Wallet, UserCircle, MapPinned, FileSearch,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePrefs } from '../lib/prefs';
import { Wordmark } from './Logo';
import Customizer from './Customizer';
import { label } from '../lib/format';

const LINKS = {
  GUEST: [{ to: '/festivals', label: 'Festivals', icon: Compass }],
  ATTENDEE: [
    { to: '/festivals', label: 'Festivals', icon: Compass },
    { to: '/tickets', label: 'My tickets', icon: Ticket },
    { to: '/orders', label: 'Orders', icon: ClipboardList },
    { to: '/transactions', label: 'Payments', icon: Wallet },
  ],
  ORGANIZER: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/festivals', label: 'Festivals', icon: CalendarDays },
    { to: '/admin/vendors', label: 'Vendors', icon: Store },
    { to: '/admin/finance', label: 'Payments & refunds', icon: Receipt },
    { to: '/admin/audit', label: 'Audit', icon: FileSearch },
    { to: '/admin/users', label: 'Users', icon: Users },
  ],
  AUDITOR: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/festivals', label: 'Festivals', icon: CalendarDays },
    { to: '/admin/finance', label: 'Ledger', icon: Receipt },
    { to: '/admin/audit', label: 'Audit trail', icon: ShieldCheck },
    { to: '/admin/vendors', label: 'Vendors', icon: Store },
  ],
  VENDOR_MANAGER: [
    { to: '/vendor', label: 'My businesses', icon: Store, end: true },
    { to: '/vendor/stalls', label: 'Find a stall', icon: MapPinned },
    { to: '/vendor/applications', label: 'Applications', icon: ClipboardList },
    { to: '/transactions', label: 'Payments', icon: Wallet },
  ],
  GATE_STAFF: [
    { to: '/gate', label: 'Scanner', icon: ScanLine },
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const links = LINKS[user ? user.role : 'GUEST'];
  const initials = user ? user.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() : '';
  const doLogout = () => { logout(); nav('/'); };

  const linkEls = links.map((l) => (
    <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
      <l.icon size={16} />{l.label}
    </NavLink>
  ));

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="stage-bg" aria-hidden="true"><i /><i /><i /><i /><b className="aurora" /><b className="specks" /></div>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand" aria-label="FestPass home"><Wordmark variant={prefs.logo} /></Link>
          <nav className="nav-links" aria-label="Main">{linkEls}</nav>
          <div className="nav-right" style={{ marginLeft: 'auto' }}>
            <Customizer />
            {user ? (
              <>
                <Link to="/profile" className="user-chip" title="Profile" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="avatar">{initials}</span>
                  <span className="who"><b>{user.full_name}</b><span>{label(user.role)}</span></span>
                </Link>
                <button className="btn btn-ghost btn-icon" onClick={doLogout} title="Sign out" aria-label="Sign out"><LogOut size={18} /></button>
              </>
            ) : (
              <>
                <Link to="/login" state={{ from: loc.pathname }} className="btn btn-ghost">Sign in</Link>
                <Link to="/register" className="btn btn-primary">Create account</Link>
              </>
            )}
            <button className="btn btn-outline btn-icon menu-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>{open ? <X size={18} /> : <Menu size={18} />}</button>
          </div>
        </div>
        <span className="route-line" key={loc.pathname} aria-hidden="true" />
        {open && (
          <nav className="mobile-menu" aria-label="Main">
            {linkEls}
            {user && <NavLink to="/profile" className="nav-link" onClick={() => setOpen(false)}><UserCircle size={16} />Profile</NavLink>}
          </nav>
        )}
      </header>
      <main className="main" id="main" tabIndex={-1}><div className="container page" key={loc.pathname}><Outlet /></div></main>
      <footer className="footer">
        <div className="container row-between">
          <span>© {new Date().getFullYear()} FestPass · Named digital tickets, gate control and vendor management</span>
          <span>Prices in Turkish lira (TRY)</span>
        </div>
      </footer>
    </div>
  );
}
