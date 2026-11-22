import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import {
  Ticket, Compass, LayoutDashboard, CalendarDays, Store, ScanLine, Receipt, Users, ShieldCheck, Home as HomeIcon,
  LogOut, Menu, X, ClipboardList, Wallet, UserCircle, MapPinned, FileSearch, Plus, Sparkles, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { label } from '../lib/format';

/** Navigation per role, grouped into sections. `tab` marks links shown in the phone tab bar. */
const NAV = {
  ATTENDEE: {
    cta: { to: '/festivals', label: 'Find tickets', icon: Sparkles },
    sections: [
      { title: 'Discover', links: [
        { to: '/', label: 'Home', icon: HomeIcon, end: true, tab: true },
        { to: '/festivals', label: 'Festivals', icon: Compass, tab: true },
      ] },
      { title: 'My festival life', links: [
        { to: '/tickets', label: 'My tickets', icon: Ticket, tab: true },
        { to: '/orders', label: 'Orders', icon: ClipboardList },
        { to: '/transactions', label: 'Payments', icon: Wallet, tab: true },
      ] },
    ],
  },
  ORGANIZER: {
    cta: { to: '/admin/festivals?new=1', label: 'New festival', icon: Plus },
    sections: [
      { title: 'Overview', links: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, tab: true }] },
      { title: 'Manage', links: [
        { to: '/admin/festivals', label: 'Festivals', icon: CalendarDays, tab: true },
        { to: '/admin/vendors', label: 'Vendors & stalls', icon: Store, tab: true },
        { to: '/admin/finance', label: 'Payments & refunds', icon: Receipt, tab: true },
      ] },
      { title: 'Oversight', links: [
        { to: '/admin/audit', label: 'Audit', icon: FileSearch },
        { to: '/admin/users', label: 'Users & staff', icon: Users },
      ] },
      { title: 'Public site', links: [{ to: '/festivals', label: 'Browse festivals', icon: Compass }] },
    ],
  },
  AUDITOR: {
    sections: [
      { title: 'Overview', links: [{ to: '/admin', label: 'Finance overview', icon: LayoutDashboard, end: true, tab: true }] },
      { title: 'Finance', links: [{ to: '/admin/finance', label: 'Ledger', icon: Receipt, tab: true }] },
      { title: 'Oversight', links: [
        { to: '/admin/audit', label: 'Audit trail', icon: ShieldCheck, tab: true },
        { to: '/admin/festivals', label: 'Festivals', icon: CalendarDays, tab: true },
        { to: '/admin/vendors', label: 'Vendors', icon: Store },
      ] },
    ],
  },
  VENDOR_MANAGER: {
    cta: { to: '/vendor/stalls', label: 'Apply for a stall', icon: MapPinned },
    sections: [
      { title: 'Vendor portal', links: [
        { to: '/vendor', label: 'My businesses', icon: Store, end: true, tab: true },
        { to: '/vendor/stalls', label: 'Find a stall', icon: MapPinned, tab: true },
        { to: '/vendor/applications', label: 'Applications & fees', icon: ClipboardList, tab: true },
        { to: '/transactions', label: 'Payments', icon: Wallet },
      ] },
      { title: 'Explore', links: [{ to: '/festivals', label: 'Festivals', icon: Compass }] },
    ],
  },
};

const EXTRA_TITLES = [
  ['/profile', 'Profile'], ['/checkout/:id', 'Checkout'], ['/festivals/:id', 'Festival'],
  ['/admin/festivals/:id', 'Festival control room'], ['/login', 'Sign in'], ['/register', 'Create account'],
];

const isBleed = (path) => path === '/' || !!matchPath('/festivals/:id', path);

function Brand({ to = '/' }) {
  return <Link to={to} className="brand" aria-label="FestPass home"><span className="brand-mark"><Ticket size={18} /></span>FestPass</Link>;
}

const initialsOf = (name = '') => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function Main({ bleed }) {
  return (
    <main id="main" className={`main ${bleed ? 'bleed' : ''}`}>
      {bleed ? <Outlet /> : <div className="container"><Outlet /></div>}
    </main>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Brand />
            <p className="mt-2" style={{ maxWidth: 360 }}>Named digital tickets, gate control and vendor management for festivals across Türkiye.</p>
          </div>
          <div><h4>Fans</h4><Link to="/festivals">Browse festivals</Link><Link to="/tickets">My tickets</Link><Link to="/register">Create account</Link></div>
          <div><h4>Business</h4><Link to="/register?role=VENDOR_MANAGER">Become a vendor</Link><Link to="/login">Organizer sign in</Link><Link to="/login">Gate staff</Link></div>
        </div>
        <div className="footer-bottom row-between">
          <span>© {new Date().getFullYear()} FestPass</span>
          <span>All prices in Turkish lira (TRY), VAT included</span>
        </div>
      </div>
    </footer>
  );
}

/** Visitors who are not signed in: transparent nav over the hero, footer. */
function PublicShell() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const bleed = isBleed(loc.pathname);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setOpen(false), [loc.pathname]);
  const links = [{ to: '/', label: 'Home', icon: HomeIcon, end: true }, { to: '/festivals', label: 'Festivals', icon: Compass }, { to: '/register?role=VENDOR_MANAGER', label: 'For vendors', icon: Store }];
  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className={`nav ${bleed ? 'over-hero' : ''} ${scrolled || open ? 'solid' : ''}`}>
        <div className="container nav-inner">
          <Brand />
          <nav className="nav-links" aria-label="Main">
            {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{l.label}</NavLink>)}
          </nav>
          <div className="nav-right">
            <Link to="/login" state={{ from: loc.pathname }} className="btn btn-ghost hide-sm">Sign in</Link>
            <Link to="/register" className="btn btn-grad">Get started</Link>
            <button className="btn btn-glass btn-icon menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>{open ? <X size={18} /> : <Menu size={18} />}</button>
          </div>
        </div>
        {open && (
          <nav className="mobile-menu" aria-label="Mobile">
            {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className="nav-link"><l.icon size={17} />{l.label}</NavLink>)}
            <NavLink to="/login" className="nav-link"><UserCircle size={17} />Sign in</NavLink>
          </nav>
        )}
      </header>
      <Main bleed={bleed} />
      <Footer />
    </div>
  );
}

/** Gate staff: nothing but the scanner, sized for a phone held in one hand. */
function GateShell({ user, onLogout }) {
  return (
    <div className="app gate-shell">
      <header className="gate-bar">
        <Brand to="/gate" />
        <span className="role-pill"><ScanLine size={13} />Gate mode</span>
        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          <Link to="/profile" className="user-chip" title="Profile"><span className="avatar">{initialsOf(user.full_name)}</span></Link>
          <button className="btn btn-ghost btn-icon" onClick={onLogout} title="Sign out" aria-label="Sign out"><LogOut size={18} /></button>
        </div>
      </header>
      <main id="main" className="main"><div className="container"><Outlet /></div></main>
    </div>
  );
}

/** Signed-in fans, organizers, auditors and vendors: sidebar + top bar. */
function AppShell({ user, onLogout }) {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const cfg = NAV[user.role] || NAV.ATTENDEE;
  const bleed = isBleed(loc.pathname);
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const all = cfg.sections.flatMap((s) => s.links);
  const current = all.find((l) => matchPath({ path: l.to.split('?')[0], end: !!l.end }, loc.pathname))
    || EXTRA_TITLES.map(([p, t]) => matchPath(p, loc.pathname) && { label: t }).find(Boolean);
  const tabs = all.filter((l) => l.tab).slice(0, 4);

  return (
    <div className={`app shell app-shell ${open ? 'drawer-open' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="row-between"><Brand /><button className="btn btn-ghost btn-icon menu-btn" style={{ display: open ? 'inline-flex' : 'none' }} onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
        {cfg.cta && <Link to={cfg.cta.to} className="btn btn-grad side-cta"><cfg.cta.icon size={16} />{cfg.cta.label}</Link>}
        <nav aria-label="Main">
          {cfg.sections.map((s) => (
            <div className="side-section" key={s.title}>
              <div className="side-title">{s.title}</div>
              {s.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
                  <l.icon size={18} />{l.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <Link to="/profile" className="user-card" title="Profile">
              <span className="avatar">{initialsOf(user.full_name)}</span>
              <span className="who"><b>{user.full_name}</b><span>{label(user.role)}</span></span>
            </Link>
            <button className="btn btn-ghost btn-icon" onClick={onLogout} title="Sign out" aria-label="Sign out"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>
      <div className="drawer-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />

      <div className="shell-main">
        <header className="topbar">
          <button className="btn btn-outline btn-icon menu-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><Menu size={18} /></button>
          <Brand />
          <div className="crumb"><span>{label(user.role)}</span><ChevronRight size={14} /><b>{current?.label || 'FestPass'}</b></div>
          <div className="topbar-actions">
            <span className="role-pill hide-sm">{label(user.role)}</span>
            <Link to="/profile" className="user-chip" title="Profile" aria-label="Profile"><span className="avatar">{initialsOf(user.full_name)}</span></Link>
          </div>
        </header>
        <Main bleed={bleed} />
      </div>

      <nav className="tabbar" aria-label="Quick">
        {tabs.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}><l.icon size={20} />{l.label.split(' ')[0] === 'My' ? l.label.split(' ')[1].replace(/^\w/, (c) => c.toUpperCase()) : l.label.split(' ')[0]}</NavLink>
        ))}
        <button onClick={() => setOpen(true)}><Menu size={20} />More</button>
      </nav>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const doLogout = () => { logout(); nav('/'); };
  if (!user) return <PublicShell />;
  if (user.role === 'GATE_STAFF') return <GateShell user={user} onLogout={doLogout} />;
  return <AppShell user={user} onLogout={doLogout} />;
}
