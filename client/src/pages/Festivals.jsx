import { useState } from 'react';
import { Search, Compass } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import FestivalCard from '../components/FestivalCard';
import { Empty, ErrorState, Loading } from '../components/ui';

export default function Festivals() {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch(() => api.get(`/festivals${qs({ q, city, status })}`), [q, city, status]);
  return (
    <>
      <div className="page-head">
        <div><h1>Festivals</h1><p>Find your next weekend. All prices include VAT.</p></div>
      </div>
      <div className="card card-pad mb-2">
        <div className="row" style={{ gap: 12 }}>
          <div className="input-icon" style={{ flex: '1 1 260px' }}>
            <Search size={16} />
            <input className="input" placeholder="Search by name, venue or city" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 180 }} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">All cities</option>
            {(data?.cities || []).map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">On sale & live</option>
            <option value="ON_SALE">On sale</option>
            <option value="LIVE">Live now</option>
            <option value="COMPLETED">Past</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <Loading /> : data.festivals.length === 0 ? (
        <div className="card"><Empty icon={Compass} title="No festivals match">Try a different search or city.</Empty></div>
      ) : (
        <div className="grid grid-auto">{data.festivals.map((f) => <FestivalCard key={f.festival_id} f={f} />)}</div>
      )}
    </>
  );
}
