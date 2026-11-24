import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, QrCode, ShieldCheck, Repeat, Store, Ticket, MapPin, CalendarDays, Radio, Music2, UtensilsCrossed, Tent, ScanLine, Check,
} from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { useAuth, HOME_BY_ROLE } from '../lib/auth';
import { scenePhoto } from '../lib/media';
import FestivalCard from '../components/FestivalCard';
import FestivalArt from '../components/FestivalArt';
import { Badge, Loading } from '../components/ui';
import { dateRange, money, num, parse } from '../lib/format';

function useCountdown(target) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ms = Math.max(0, (target ? target.getTime() : 0) - now);
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

function HeroCountdown({ start }) {
  const c = useCountdown(parse(start));
  const parts = [['d', 'Days'], ['h', 'Hours'], ['m', 'Min'], ['s', 'Sec']];
  return (
    <div className="hero-countdown" aria-label="Time until gates open">
      {parts.map(([k, l]) => <div key={k}><b>{String(c[k]).padStart(2, '0')}</b><span>{l}</span></div>)}
    </div>
  );
}

const EXPERIENCES = [
  { key: 'stage', icon: Music2, t: 'Main stages', d: 'Headline sets, light shows and late-night sessions under the open sky.', art: 2 },
  { key: 'food', icon: UtensilsCrossed, t: 'Food court', d: 'Local food trucks, bars and coffee from verified vendors with hygiene certificates.', art: 3 },
  { key: 'camping', icon: Tent, t: 'Camping', d: 'Pitch up with your crew. Camping zones sit right next to the festival site.', art: 5 },
  { key: 'dj', icon: ScanLine, t: 'Fast entry', d: 'Show your QR code, get scanned and you are in. Step out and back in any time.', art: 4 },
];

export default function Home() {
  const { user } = useAuth();
  const { data, loading } = useFetch(() => api.get('/festivals'), []);
  const festivals = data?.festivals || [];
  const live = festivals.filter((f) => f.status === 'LIVE');
  const onSale = festivals.filter((f) => f.status === 'ON_SALE');
  const featured = onSale[0] || live[0];
  const cities = new Set(festivals.map((f) => f.city));

  return (
    <>
      {/* ---------- immersive hero ---------- */}
      <section className="hero-x">
        <FestivalArt id={featured?.festival_id ?? 0} name={featured?.name} w={2000} eager />
        <div className="container">
          <div className="hero-content">
            {featured ? (
              <>
                <div className="row reveal">
                  <span className="chip"><Radio size={13} />{featured.status === 'LIVE' ? 'Happening now' : 'Next up'}</span>
                  <span className="chip">{featured.min_age}+</span>
                </div>
                <h1 className="mt-2 reveal-2">{featured.name}</h1>
                <div className="hero-meta reveal-2">
                  <span><CalendarDays size={17} />{dateRange(featured.start_date, featured.end_date)}</span>
                  <span><MapPin size={17} />{featured.venue_name}, {featured.city}</span>
                </div>
                {featured.status === 'ON_SALE' && <div className="reveal-3"><HeroCountdown start={featured.start_date} /></div>}
                <div className="hero-actions reveal-3">
                  <Link to={`/festivals/${featured.festival_id}`} className="btn btn-grad btn-lg">
                    <Ticket size={18} />{featured.min_price != null ? `Tickets from ${money(featured.min_price)}` : 'View festival'}
                  </Link>
                  <Link to="/festivals" className="btn btn-glass btn-lg">All festivals <ArrowRight size={18} /></Link>
                </div>
              </>
            ) : (
              <>
                <span className="chip reveal"><Ticket size={13} />Named digital tickets</span>
                <h1 className="mt-2 reveal-2">Your festival season, <span className="grad-text">in one pass.</span></h1>
                <p className="lead reveal-2">Buy named tickets with secure QR codes, pass one to a friend, get refunds by clear rules and walk straight through the gate.</p>
                <div className="hero-actions reveal-3">
                  <Link to="/festivals" className="btn btn-grad btn-lg">Browse festivals <ArrowRight size={18} /></Link>
                </div>
              </>
            )}
            <div className="hero-stats reveal-3">
              <div><b>{festivals.length}</b><span>festivals on sale & live</span></div>
              <div><b>{num(festivals.reduce((s, f) => s + Number(f.tickets_remaining || 0), 0))}</b><span>tickets available</span></div>
              <div><b>{cities.size}</b><span>cities</span></div>
            </div>
          </div>
        </div>
      </section>

      {festivals.length > 0 && (
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[0, 1].map((k) => festivals.map((f) => <span key={`${k}-${f.festival_id}`}>{f.name} · {f.city}</span>))}
          </div>
        </div>
      )}

      <div className="container">
        {live.length > 0 && (
          <div className="mt-3 stack-sm">
            {live.map((f) => (
              <Link key={f.festival_id} to={`/festivals/${f.festival_id}`} className="live-strip">
                <Badge value="LIVE">Live now</Badge>
                <b>{f.name}</b>
                <span className="muted small">{f.venue_name}, {f.city} · gates are open</span>
                <span className="fest-go" style={{ marginLeft: 'auto' }}>Festival info <ArrowRight size={15} /></span>
              </Link>
            ))}
          </div>
        )}

        {/* ---------- line-up of festivals ---------- */}
        <section className="section">
          <div className="section-head">
            <div><span className="eyebrow">On sale now</span><h2>Upcoming festivals</h2><p>Pick a weekend, choose your tier and get your named QR ticket in under a minute.</p></div>
            <Link to="/festivals" className="btn btn-outline">See all festivals <ArrowRight size={16} /></Link>
          </div>
          {loading ? <Loading /> : (
            <div className="grid grid-auto">{festivals.slice(0, 6).map((f) => <FestivalCard key={f.festival_id} f={f} />)}</div>
          )}
        </section>

        {/* ---------- on-site experience ---------- */}
        <section className="section">
          <div className="section-head">
            <div><span className="eyebrow">On site</span><h2>More than a ticket</h2><p>Every FestPass festival is mapped into zones, so you know where the music, food and tents are before you arrive.</p></div>
          </div>
          <div className="exp-grid">
            {EXPERIENCES.map((x, i) => (
              <div key={x.key} className="exp">
                <FestivalArt id={x.art} name={x.t} photo={scenePhoto(x.key)} w={800} />
                <div>
                  <span className="num">0{i + 1}</span>
                  <h3 className="row mt-1" style={{ gap: 8 }}><x.icon size={18} />{x.t}</h3>
                  <p>{x.d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="section">
          <div className="section-head">
            <div><span className="eyebrow">How it works</span><h2>Fair tickets, clear rules</h2></div>
          </div>
          <div className="steps">
            {[
              { icon: Ticket, tone: '', t: 'Book in minutes', d: 'Your seats are held for 10 minutes while you pay. Up to 10 named tickets per festival.' },
              { icon: QrCode, tone: 'pink', t: 'Unique QR per ticket', d: 'A random 256-bit code, regenerated whenever a ticket changes hands.' },
              { icon: Repeat, tone: 'blue', t: 'One fair transfer', d: 'Pass a ticket to a friend once, up to 48 hours before the festival starts.' },
              { icon: ShieldCheck, tone: 'green', t: 'Clear refunds', d: '90% a month out, 50% a week out, and 100% back if the festival is cancelled.' },
            ].map((x) => (
              <div key={x.t} className="card step hoverable">
                <div className={`stat-icon ${x.tone}`}><x.icon size={20} /></div>
                <h3>{x.t}</h3>
                <p>{x.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- vendors / account CTA ---------- */}
        <section className="section">
          <div className="cta-band">
            <div>
              <span className="eyebrow">For vendors</span>
              <h2 className="mt-1">Run a food truck, bar or merch stand?</h2>
              <p>Register your business, pick a stall on the festival site map and pay your fee online. Organizers review every application.</p>
              <div className="hero-actions" style={{ marginTop: 22 }}>
                {user
                  ? <Link to={HOME_BY_ROLE[user.role]} className="btn btn-grad btn-lg">Go to my area <ArrowRight size={18} /></Link>
                  : <Link to="/register?role=VENDOR_MANAGER" className="btn btn-grad btn-lg"><Store size={18} />Become a vendor</Link>}
              </div>
            </div>
            <div className="cta-list">
              {['Live stall map with sizes, power and fees', 'One approved vendor per stall, no double booking', 'Fee due within 7 days of approval', 'Full refund if you cancel 21+ days before the festival'].map((t) => (
                <div key={t}><Check size={18} />{t}</div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
