import { Link } from 'react-router-dom';
import { MapPin, ArrowUpRight } from 'lucide-react';
import FestivalArt from './FestivalArt';
import { Badge, Progress } from './ui';
import { dateRange, money, parse } from '../lib/format';
import { vibe } from '../lib/vibe';

export default function FestivalCard({ f, index = 0 }) {
  const d = parse(f.start_date);
  const sold = Number(f.total_quota) - Number(f.tickets_remaining);
  const lowStock = f.tickets_remaining > 0 && f.tickets_remaining / f.total_quota < 0.1;
  const { genre, accent } = vibe(f);
  return (
    <Link to={`/festivals/${f.festival_id}`} className="fest-card" style={{ '--accent': accent, '--i': index }}>
      <FestivalArt id={f.festival_id} name={f.name} eager={index < 3} />
      <div className="fest-shade" />
      <div className="fest-top">
        <div className="row" style={{ gap: 6 }}>
          <Badge value={f.status}>{f.status === 'LIVE' ? 'Live now' : undefined}</Badge>
          {lowStock && <Badge tone="amber">Selling fast</Badge>}
        </div>
        <div className="date-pill"><b>{d.getDate()}</b><span>{d.toLocaleDateString('en-GB', { month: 'short' })}</span></div>
      </div>
      <div className="fest-body">
        <span className="genre">{genre}</span>
        <h3>{f.name}</h3>
        <div className="fest-meta"><MapPin size={14} />{f.venue_name}, {f.city}</div>
        <div className="fest-meta">{dateRange(f.start_date, f.end_date)} · {f.min_age}+</div>
        <div className="fest-foot">
          <div className="price-from">From<b>{f.min_price != null ? money(f.min_price) : '—'}</b></div>
          <div className="fest-stock">
            <div className="tiny right mb-1">{f.tickets_remaining > 0 ? `${Number(f.tickets_remaining).toLocaleString()} left` : 'Sold out'}</div>
            <Progress value={sold} max={f.total_quota} />
          </div>
        </div>
        <span className="fest-cta">Get tickets <ArrowUpRight size={16} /></span>
      </div>
    </Link>
  );
}

export function FestivalCardSkeleton() {
  return <div className="fest-card skeleton" aria-hidden="true" />;
}
