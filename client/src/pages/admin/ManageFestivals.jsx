import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { useAuth } from '../../lib/auth';
import FestivalArt from '../../components/FestivalArt';
import { Badge, Empty, ErrorState, Loading, Progress } from '../../components/ui';
import FestivalForm from './FestivalForm';
import { dateRange, money, num, pct } from '../../lib/format';

export default function ManageFestivals() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useFetch(() => api.get('/festivals/mine'), []);
  const [creating, setCreating] = useState(params.get('new') === '1');
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const isOrg = user.role === 'ORGANIZER';
  return (
    <>
      <div className="page-head">
        <div><h1>{isOrg ? 'My festivals' : 'All festivals'}</h1><p>Lifecycle: draft → on sale → live → completed. Any stage but completed can be cancelled.</p></div>
        {isOrg && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />New festival</button>}
      </div>
      {data.festivals.length === 0 ? (
        <div className="card"><Empty icon={CalendarDays} title="No festivals yet" action={isOrg && <button className="btn btn-primary" onClick={() => setCreating(true)}>Create your first festival</button>} /></div>
      ) : (
        <div className="grid grid-auto">
          {data.festivals.map((f) => (
            <Link key={f.festival_id} to={`/admin/festivals/${f.festival_id}`} className="card fest-card">
              <div className="fest-art" style={{ height: 110 }}>
                <FestivalArt id={f.festival_id} name={f.name} />
                <div className="badges"><Badge value={f.status} /></div>
              </div>
              <div className="fest-body">
                <h3>{f.name}</h3>
                <div className="fest-meta">{f.venue_name}, {f.city} · {dateRange(f.start_date, f.end_date)}</div>
                <div className="mt-1">
                  <div className="row-between tiny muted mb-1"><span>{num(f.tickets_sold)} / {num(f.total_quota)} sold</span><span>{pct(f.tickets_sold, f.total_quota)}%</span></div>
                  <Progress value={f.tickets_sold} max={f.total_quota || 1} />
                </div>
                <div className="row-between small mt-1"><span className="muted">Revenue</span><b>{money(f.ticket_revenue)}</b></div>
                <div className="row-between small"><span className="muted">Stalls</span><span>{f.stalls_allocated} / {f.stall_count} allocated</span></div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <FestivalForm onClose={() => { setCreating(false); setParams({}); }} onSaved={(id) => nav(`/admin/festivals/${id}`)} />}
    </>
  );
}
