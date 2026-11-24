import { Link } from 'react-router-dom';
import { ArrowRight, QrCode, ShieldCheck, Repeat, Store } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { useAuth, HOME_BY_ROLE } from '../lib/auth';
import FestivalCard, { FestivalCardSkeleton } from '../components/FestivalCard';

const PERKS = [
  { icon: QrCode, t: 'Unique QR per ticket', d: 'A random 256-bit code, regenerated whenever a ticket changes hands.' },
  { icon: Repeat, t: 'One fair transfer', d: 'Pass a ticket to a friend once, up to 48 hours before doors open.' },
  { icon: ShieldCheck, t: 'Clear refunds', d: '90% a month out, 50% a week out, 100% if the festival is cancelled.' },
  { icon: Store, t: 'Vendor stalls', d: 'Food trucks, bars and merch brands apply for stalls on the site map.' },
];

export default function Home() {
  const { user } = useAuth();
  const { data } = useFetch(() => api.get('/festivals'), []);
  const festivals = data?.festivals || [];
  return (
    <>
      <section className="hero">
        <img className="hero-photo" src="/img/haze.webp" alt="" fetchpriority="high" />
        <div className="hero-copy">
          <h1>Your festival season, in one pass.</h1>
          <p>Buy named tickets with secure QR codes, send one to a friend, get refunds by clear rules, and walk straight through the gate.</p>
          <div className="row hero-actions">
            <Link to="/festivals" className="btn btn-grad btn-lg">Browse festivals <ArrowRight size={18} /></Link>
            {user
              ? <Link to={HOME_BY_ROLE[user.role]} className="btn btn-glass btn-lg">Go to my area</Link>
              : <Link to="/register?role=VENDOR_MANAGER" className="btn btn-glass btn-lg">I'm a vendor</Link>}
          </div>
        </div>
        <dl className="hero-stats">
          <div><dt>Festivals on sale</dt><dd>{data ? festivals.length : '–'}</dd></div>
          <div><dt>Tickets available</dt><dd>{data ? festivals.reduce((s, f) => s + Number(f.tickets_remaining || 0), 0).toLocaleString() : '–'}</dd></div>
          <div><dt>Cities</dt><dd>{data ? new Set(festivals.map((f) => f.city)).size : '–'}</dd></div>
        </dl>
      </section>

      <div className="row-between mb-2">
        <h2 className="section-title">Upcoming festivals</h2>
        <Link to="/festivals" className="btn btn-ghost btn-sm">See all <ArrowRight size={15} /></Link>
      </div>
      <div className="grid grid-auto">
        {data ? festivals.slice(0, 6).map((f, i) => <FestivalCard key={f.festival_id} f={f} index={i} />)
          : [0, 1, 2].map((i) => <FestivalCardSkeleton key={i} />)}
      </div>

      <ul className="perks">
        {PERKS.map((x) => (
          <li key={x.t}>
            <x.icon size={22} />
            <h3>{x.t}</h3>
            <p>{x.d}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
