import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapPin, CalendarDays, Users, ShieldCheck, Repeat, Clock, BadgePercent, Store, UserPlus, Timer } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../lib/auth';
import FestivalArt from '../components/FestivalArt';
import { Alert, Badge, ErrorState, Loading, Progress, useToast } from '../components/ui';
import { dateRange, dateTime, money, num } from '../lib/format';

export default function FestivalDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => api.get(`/festivals/${id}`), [id]);
  const [qty, setQty] = useState({});
  const [holders, setHolders] = useState({});
  const [showHolders, setShowHolders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const lines = useMemo(() => (data?.tiers || []).filter((t) => qty[t.tier_id] > 0).map((t) => ({ tier: t, quantity: qty[t.tier_id] })), [data, qty]);
  const total = lines.reduce((s, l) => s + l.quantity * Number(l.tier.price), 0);
  const count = lines.reduce((s, l) => s + l.quantity, 0);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { festival: f, tiers } = data;
  const canBuy = f.status === 'ON_SALE';
  const days = f.days_until;
  const band = days >= 30 ? '90%' : days >= 7 ? '50%' : 'No refund';

  const setQ = (tier, n) => {
    const v = Math.max(0, Math.min(n, tier.max_per_order, tier.remaining));
    setQty((q) => ({ ...q, [tier.tier_id]: v }));
  };

  const reserve = async () => {
    setFormError(null);
    if (!user) { nav('/login', { state: { from: `/festivals/${id}` } }); return; }
    setBusy(true);
    try {
      const items = lines.map((l) => ({
        tier_id: l.tier.tier_id,
        quantity: l.quantity,
        holder_emails: showHolders ? Array.from({ length: l.quantity }, (_, i) => (holders[`${l.tier.tier_id}-${i}`] || '').trim()) : [],
      }));
      const r = await api.post('/orders', { festival_id: f.festival_id, items });
      toast.success('Tickets reserved for 10 minutes');
      nav(`/checkout/${r.order.order_id}`);
    } catch (e) {
      setFormError(e.message);
      reload(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="detail-hero">
        <FestivalArt id={f.festival_id} name={f.name} eager />
        <div className="overlay" />
        <div className="content">
          <div className="row"><Badge value={f.status}>{f.status === 'LIVE' ? 'Live now' : undefined}</Badge><span className="chip">{f.min_age}+ only</span></div>
          <h1 className="mt-1">{f.name}</h1>
          <div className="fest-meta">
            <span><MapPin size={15} />{f.venue_name}, {f.city}</span>
            <span><CalendarDays size={15} />{dateRange(f.start_date, f.end_date)}</span>
            <span><Users size={15} />{num(f.daily_capacity)} per day</span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Tickets</h2>{canBuy && <span className="muted small">Max {Math.min(10, ...tiers.map((t) => t.max_per_order))}–{Math.max(...tiers.map((t) => t.max_per_order), 0)} per order, 10 per festival</span>}</div>
            <div className="card-body stack">
              {!canBuy && <Alert kind="warning">{f.status === 'LIVE' ? 'This festival is happening now; online sales are closed.' : `Ticket sales are ${f.status === 'DRAFT' ? 'not open yet' : 'closed'}.`}</Alert>}
              {tiers.map((t) => {
                const soldOut = t.remaining <= 0;
                const available = canBuy && t.on_sale_now && !soldOut;
                return (
                  <div key={t.tier_id} className={`tier ${qty[t.tier_id] ? 'selected' : ''} ${available ? '' : 'disabled'}`}>
                    <div className="tier-info">
                      <h3>{t.tier_name}
                        {soldOut && <Badge tone="red">Sold out</Badge>}
                        {!soldOut && t.sale_not_started ? <Badge tone="amber">Sale opens {dateTime(t.sale_start)}</Badge> : null}
                        {!soldOut && t.remaining / t.quota < 0.1 && <Badge tone="amber">{t.remaining} left</Badge>}
                      </h3>
                      <div className="small muted mt-1">Up to {t.max_per_order} per order · sales end {dateTime(t.sale_end)}</div>
                      <div className="mt-1" style={{ maxWidth: 220 }}><Progress value={t.sold} max={t.quota} /></div>
                    </div>
                    <div className="tier-price">{Number(t.price) === 0 ? 'Free' : money(t.price)}</div>
                    {available && (
                      <div className="qty">
                        <button onClick={() => setQ(t, (qty[t.tier_id] || 0) - 1)} disabled={!qty[t.tier_id]} aria-label="Less">−</button>
                        <span>{qty[t.tier_id] || 0}</span>
                        <button onClick={() => setQ(t, (qty[t.tier_id] || 0) + 1)} disabled={(qty[t.tier_id] || 0) >= Math.min(t.max_per_order, t.remaining)} aria-label="More">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card card-pad">
            <h2 className="mb-2">Good to know</h2>
            <div className="rules-list">
              <div className="rule-item"><div className="ic"><ShieldCheck size={17} /></div><div><b>Named tickets, {f.min_age}+</b><p className="small muted">Every ticket carries one holder's name. Holders must be at least {f.min_age} on {dateRange(f.start_date, f.start_date)}.</p></div></div>
              <div className="rule-item"><div className="ic"><BadgePercent size={17} /></div><div><b>Refunds: 90% / 50% / none</b><p className="small muted">90% if you cancel 30+ days before, 50% from 7 to 29 days, nothing in the final week or after check-in. Right now: <b>{band}</b>. If the organizer cancels, you get 100% back.</p></div></div>
              <div className="rule-item"><div className="ic"><Repeat size={17} /></div><div><b>One transfer per ticket</b><p className="small muted">You can pass a ticket to another FestPass user once, until 48 hours before the gates open. Their QR code is freshly generated.</p></div></div>
              <div className="rule-item"><div className="ic"><Clock size={17} /></div><div><b>10-minute checkout hold</b><p className="small muted">Your tickets are held while you pay. Unpaid holds expire and go back on sale.</p></div></div>
            </div>
          </div>

          {user?.role === 'VENDOR_MANAGER' && f.status !== 'COMPLETED' && f.status !== 'CANCELLED' && (
            <div className="card card-pad row-between">
              <div className="row"><div className="stat-icon pink"><Store size={20} /></div><div><b>Selling at {f.name}?</b><p className="small muted">See the site map and apply for a stall.</p></div></div>
              <Link to={`/vendor/stalls?festival=${f.festival_id}`} className="btn btn-outline">View stalls</Link>
            </div>
          )}
        </div>

        <div className="card sticky">
          <div className="card-head"><h2>Your order</h2></div>
          <div className="card-body">
            {count === 0 ? <p className="muted small">Pick one or more tickets to continue.</p> : (
              <>
                {lines.map((l) => (
                  <div key={l.tier.tier_id} className="summary-line"><span>{l.quantity} × {l.tier.tier_name}</span><span>{money(l.quantity * l.tier.price)}</span></div>
                ))}
                <div className="summary-total"><span>Total</span><span>{money(total)}</span></div>

                <label className="checkbox mt-2"><input type="checkbox" checked={showHolders} onChange={(e) => setShowHolders(e.target.checked)} /><UserPlus size={15} />Name tickets for friends</label>
                {showHolders && (
                  <div className="stack-sm mt-1">
                    <p className="tiny muted">Enter the email of each friend's FestPass account. Leave a field empty to keep that ticket in your name.</p>
                    {lines.flatMap((l) => Array.from({ length: l.quantity }, (_, i) => (
                      <input key={`${l.tier.tier_id}-${i}`} className="input" type="email" placeholder={`${l.tier.tier_name} #${i + 1}: friend@email.com`}
                        value={holders[`${l.tier.tier_id}-${i}`] || ''} onChange={(e) => setHolders((h) => ({ ...h, [`${l.tier.tier_id}-${i}`]: e.target.value }))} />
                    )))}
                  </div>
                )}
              </>
            )}
            {formError && <div className="mt-2"><Alert kind="error">{formError}</Alert></div>}
            <button className="btn btn-grad btn-lg w-full mt-2" disabled={!canBuy || count === 0 || busy} onClick={reserve}>
              <Timer size={18} />{busy ? 'Reserving…' : user ? 'Reserve & pay' : 'Sign in to buy'}
            </button>
            <p className="tiny faint center mt-1">Organised by {f.organizer_name}</p>
          </div>
        </div>
      </div>
    </>
  );
}
