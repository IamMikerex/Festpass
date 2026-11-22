import { Link } from 'react-router-dom';
import { ArrowRight, QrCode, ShieldCheck, Repeat, Store, Ticket } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { useAuth, HOME_BY_ROLE } from '../lib/auth';
import FestivalCard from '../components/FestivalCard';
import { Loading } from '../components/ui';

export default function Home() {
  const { user } = useAuth();
  const { data, loading } = useFetch(() => api.get('/festivals'), []);
  const festivals = data?.festivals || [];
  return (
    <>
      <section className="hero">
        <span className="chip"><Ticket size={13} /> Named digital tickets</span>
        <h1 className="mt-2">Your festival season, in one pass.</h1>
        <p>Buy named tickets with secure QR codes, send one to a friend, get refunds by clear rules, and walk straight through the gate.</p>
        <div className="row">
          <Link to="/festivals" className="btn btn-grad btn-lg">Browse festivals <ArrowRight size={18} /></Link>
          {user
            ? <Link to={HOME_BY_ROLE[user.role]} className="btn btn-lg" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>Go to my area</Link>
            : <Link to="/register?role=VENDOR_MANAGER" className="btn btn-lg" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>I'm a vendor</Link>}
        </div>
        <div className="hero-stats">
          <div><b>{festivals.length}</b><span>festivals on sale</span></div>
          <div><b>{festivals.reduce((s, f) => s + Number(f.tickets_remaining || 0), 0).toLocaleString()}</b><span>tickets available</span></div>
          <div><b>{new Set(festivals.map((f) => f.city)).size}</b><span>cities</span></div>
        </div>
      </section>

      <div className="row-between mb-2">
        <h2>Upcoming festivals</h2>
        <Link to="/festivals" className="btn btn-ghost btn-sm">See all <ArrowRight size={15} /></Link>
      </div>
      {loading ? <Loading /> : (
        <div className="grid grid-auto">{festivals.slice(0, 6).map((f) => <FestivalCard key={f.festival_id} f={f} />)}</div>
      )}

      <div className="grid grid-4 mt-3">
        {[
          { icon: QrCode, t: 'Unique QR per ticket', d: 'A random 256-bit code, regenerated whenever a ticket changes hands.' },
          { icon: Repeat, t: 'One fair transfer', d: 'Pass a ticket to a friend once, up to 48 hours before doors open.' },
          { icon: ShieldCheck, t: 'Clear refunds', d: '90% a month out, 50% a week out, 100% if the festival is cancelled.' },
          { icon: Store, t: 'Vendor stalls', d: 'Food trucks, bars and merch brands apply for stalls on the site map.' },
        ].map((x) => (
          <div key={x.t} className="card card-pad">
            <div className="stat-icon mb-1"><x.icon size={20} /></div>
            <h3>{x.t}</h3>
            <p className="muted small mt-1">{x.d}</p>
          </div>
        ))}
      </div>
    </>
  );
}
