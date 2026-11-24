import { useState } from 'react';
import { Search, Compass, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import FestivalCard from '../components/FestivalCard';
import { Empty, ErrorState, Loading } from '../components/ui';

const STATUSES = [
  { id: '', label: 'On sale & live' }, { id: 'ON_SALE', label: 'On sale' }, { id: 'LIVE', label: 'Live now' },
  { id: 'COMPLETED', label: 'Past' }, { id: 'CANCELLED', label: 'Cancelled' },
];

export default function Festivals() {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch(() => api.get(`/festivals${qs({ q, city, status })}`), [q, city, status]);
  const filtered = q || city || status;
  return (
    <>
      <section className="browse-hero">
        <span className="eyebrow">Festival line-up</span>
        <h1 className="mt-1">Find your next weekend</h1>
        <p>Open-air stages, beach sessions and late nights across Türkiye. All prices include VAT.</p>
        <div className="filters">
          <div className="input-icon">
            <Search size={17} />
            <input className="input" placeholder="Search by festival, venue or city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search festivals" />
          </div>
          <select className="select" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
            <option value="">All cities</option>
            {(data?.cities || []).map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="chips mt-2" role="group" aria-label="Status">
          {STATUSES.map((s) => <button key={s.id} type="button" className={`chip-btn ${status === s.id ? 'on' : ''}`} onClick={() => setStatus(s.id)} aria-pressed={status === s.id}>{s.label}</button>)}
          {filtered && <button type="button" className="chip-btn" onClick={() => { setQ(''); setCity(''); setStatus(''); }}><X size={14} />Clear</button>}
        </div>
      </section>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <Loading /> : data.festivals.length === 0 ? (
        <div className="card"><Empty icon={Compass} title="No festivals match">Try a different search, city or status.</Empty></div>
      ) : (
        <>
          <p className="small muted mb-2">{data.festivals.length} festival{data.festivals.length === 1 ? '' : 's'}</p>
          <div className="grid grid-auto">{data.festivals.map((f) => <FestivalCard key={f.festival_id} f={f} />)}</div>
        </>
      )}
    </>
  );
}
