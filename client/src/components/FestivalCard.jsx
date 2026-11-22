import { Link } from 'react-router-dom';
import { MapPin, CalendarDays, ArrowRight } from 'lucide-react';
import FestivalArt from './FestivalArt';
import { Badge, Progress } from './ui';
import { dateRange, money, num, parse } from '../lib/format';

/** Poster-style festival card used on the home and browse pages. */
export default function FestivalCard({ f }) {
  const d = parse(f.start_date);
  const sold = Number(f.total_quota) - Number(f.tickets_remaining);
  const lowStock = f.tickets_remaining > 0 && f.tickets_remaining / f.total_quota < 0.1;
  const soldOut = Number(f.tickets_remaining) <= 0;
  return (
    <Link to={`/festivals/${f.festival_id}`} className="card fest-card" aria-label={`${f.name}, ${dateRange(f.start_date, f.end_date)}`}>
      <div className="fest-art">
        <FestivalArt id={f.festival_id} name={f.name} w={800} />
        <div className="badges">
          {f.status === 'LIVE' ? <Badge value="LIVE">Live now</Badge> : <Badge tone="solid plain">{f.min_age}+</Badge>}
          {lowStock && <Badge tone="amber">Selling fast</Badge>}
          {soldOut && f.status !== 'LIVE' && <Badge tone="red">Sold out</Badge>}
        </div>
        <div className="date-pill"><b>{d.getDate()}</b><span>{d.toLocaleDateString('en-GB', { month: 'short' })}</span></div>
        <div className="art-title"><h3>{f.name}</h3></div>
      </div>
      <div className="fest-body">
        <div className="fest-meta"><MapPin size={14} />{f.venue_name}, {f.city}</div>
        <div className="fest-meta"><CalendarDays size={14} />{dateRange(f.start_date, f.end_date)}</div>
        <div className="mt-1">
          <div className="row-between tiny muted mb-1"><span>{soldOut ? 'Sold out' : `${num(f.tickets_remaining)} tickets left`}</span><span>{f.total_quota ? Math.round((sold / f.total_quota) * 100) : 0}% sold</span></div>
          <Progress value={sold} max={f.total_quota} />
        </div>
        <div className="fest-foot">
          <div className="price-from">From<b>{f.min_price != null ? money(f.min_price) : '—'}</b></div>
          <span className="fest-go">{f.status === 'ON_SALE' && !soldOut ? 'Get tickets' : 'Details'} <ArrowRight size={15} /></span>
        </div>
      </div>
    </Link>
  );
}
