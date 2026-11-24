import { useState } from 'react';
import { Search, Compass, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { vibe } from '../lib/vibe';
import FestivalCard, { FestivalCardSkeleton } from '../components/FestivalCard';
import { Empty, ErrorState } from '../components/ui';

const STATUSES = [['', 'On sale & live'], ['ON_SALE', 'On sale'], ['LIVE', 'Live now'], ['COMPLETED', 'Past'], ['CANCELLED', 'Cancelled']];
const WHEN = [['', 'Any time', null], ['week', 'Next 7 days', 7], ['month', 'Next 30 days', 30], ['later', 'Later', Infinity]];

function Chips({ label, options, value, onChange }) {
  return (
    <div className="filter-row" role="group" aria-label={label}>
      <span className="filter-label">{label}</span>
      {options.map(([v, text]) => (
        <button key={v} type="button" className={`chip-btn ${value === v ? 'on' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export default function Festivals() {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const [genre, setGenre] = useState('');
  const [when, setWhen] = useState('');
  const { data, loading, error, reload } = useFetch(() => api.get(`/festivals${qs({ q, city, status })}`), [q, city, status]);

  const all = data?.festivals || [];
  const genres = [...new Set(all.map((f) => vibe(f).genre))].sort();
  const days = WHEN.find((w) => w[0] === when)[2];
  const inWindow = (f) => (when === 'later' ? f.days_until > 30 : f.days_until <= days && f.status !== 'COMPLETED');
  const shown = all.filter((f) => (!genre || vibe(f).genre === genre) && (!days || inWindow(f)));
  const filtered = q || city || status || genre || when;
  const clear = () => { setQ(''); setCity(''); setStatus(''); setGenre(''); setWhen(''); };

  return (
    <>
      <div className="page-head">
        <div><h1>Festivals</h1><p>Find your next weekend. All prices include VAT.</p></div>
      </div>
      <div className="filters mb-2">
        <label className="search">
          <Search size={20} />
          <input type="search" placeholder="Search festivals, venues or cities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search festivals" />
          {q && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setQ('')} aria-label="Clear search"><X size={16} /></button>}
        </label>
        <Chips label="Type" options={STATUSES} value={status} onChange={setStatus} />
        <Chips label="City" options={[['', 'All cities'], ...(data?.cities || []).map((c) => [c, c])]} value={city} onChange={setCity} />
        <Chips label="Sound" options={[['', 'All genres'], ...genres.map((g) => [g, g])]} value={genre} onChange={setGenre} />
        <Chips label="When" options={WHEN} value={when} onChange={setWhen} />
      </div>
      <div className="row-between mb-2">
        <span className="muted small" aria-live="polite">{data ? `${shown.length} festival${shown.length === 1 ? '' : 's'}` : 'Loading festivals…'}</span>
        {filtered && <button className="btn btn-ghost btn-sm" onClick={clear}><X size={14} /> Clear filters</button>}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? (
        <div className="grid grid-auto">{[0, 1, 2].map((i) => <FestivalCardSkeleton key={i} />)}</div>
      ) : shown.length === 0 ? (
        <div className="card"><Empty icon={Compass} title="No festivals match" action={<button className="btn btn-outline btn-sm" onClick={clear}>Clear filters</button>}>Try another city, genre or date.</Empty></div>
      ) : (
        <div className={`grid grid-auto ${loading ? 'is-refreshing' : ''}`}>{shown.map((f, i) => <FestivalCard key={f.festival_id} f={f} index={i} />)}</div>
      )}
    </>
  );
}
