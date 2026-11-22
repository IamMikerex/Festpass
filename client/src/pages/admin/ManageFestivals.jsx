import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Plus, Search } from 'lucide-react';
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
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const isOrg = user.role === 'ORGANIZER';
  const counts = data.festivals.reduce((m, f) => ({ ...m, [f.status]: (m[f.status] || 0) + 1 }), {});
  const needle = q.trim().toLowerCase();
  const list = data.festivals.filter((f) => (!status || f.status === status) && (!needle || `${f.name} ${f.city} ${f.venue_name}`.toLowerCase().includes(needle)));
  return (
    <>
      <div className="page-head">
        <div><h1>{isOrg ? 'My festivals' : 'All festivals'}</h1><p>Lifecycle: draft → on sale → live → completed. Any stage but completed can be cancelled.</p></div>
        {isOrg && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />New festival</button>}
      </div>
      {data.festivals.length > 0 && (
        <div className="card toolbar mb-2">
          <div className="input-icon" style={{ flex: '1 1 240px', maxWidth: 360 }}><Search size={16} /><input className="input" placeholder="Search name, city or venue" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search festivals" /></div>
          <div className="chips" role="group" aria-label="Status">
            {['', 'LIVE', 'ON_SALE', 'DRAFT', 'COMPLETED', 'CANCELLED'].filter((st) => !st || counts[st]).map((st) => (
              <button key={st || 'all'} type="button" className={`chip-btn ${status === st ? 'on' : ''}`} aria-pressed={status === st} onClick={() => setStatus(st)}>
                {st ? st.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'All'} <span className="faint">{st ? counts[st] : data.festivals.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {data.festivals.length === 0 ? (
        <div className="card"><Empty icon={CalendarDays} title="No festivals yet" action={isOrg && <button className="btn btn-primary" onClick={() => setCreating(true)}>Create your first festival</button>} /></div>
      ) : (
        <div className="grid grid-auto">
          {list.length === 0 && <div className="card" style={{ gridColumn: '1 / -1' }}><Empty icon={Search} title="No festivals match">Try another search or status.</Empty></div>}
          {list.map((f) => (
            <Link key={f.festival_id} to={`/admin/festivals/${f.festival_id}`} className="card fest-card">
              <div className="fest-art" style={{ height: 150 }}>
                <FestivalArt id={f.festival_id} name={f.name} w={700} />
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
