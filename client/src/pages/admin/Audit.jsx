import { useState } from 'react';
import { Download, Repeat, ScanLine, Search, FileSearch } from 'lucide-react';
import { analytics, qs } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { Alert, Badge, Empty, ErrorState, Loading, Tabs, useToast } from '../../components/ui';
import { TrailModal } from './FestivalAdmin';
import { dateTime, label } from '../../lib/format';

function Transfers({ onTrail }) {
  const { data, loading, error } = useFetch(() => analytics.get('/transfers'), []);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  return (
    <div className="card">
      <div className="card-head"><h3>Ticket transfers</h3><button className="btn btn-outline btn-sm" onClick={() => analytics.download('/transfers', 'transfers.csv').catch((e) => toast.error(e.message))}><Download size={15} />CSV</button></div>
      {data.transfers.length === 0 ? <Empty icon={Repeat} title="No transfers yet" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>When</th><th>Festival · tier</th><th>From</th><th>To</th><th /></tr></thead>
          <tbody>{data.transfers.map((t) => (
            <tr key={t.transfer_id}><td className="small nowrap">{dateTime(t.transferred_at)}</td><td>{t.festival_name}<div className="tiny muted">{t.tier_name}</div></td>
              <td>{t.from_name}<div className="tiny muted">{t.from_email}</div></td><td>{t.to_name}<div className="tiny muted">{t.to_email}</div></td>
              <td className="right"><button className="btn btn-ghost btn-sm" onClick={() => onTrail(t.ticket_id)}><FileSearch size={14} />Trail</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Scans({ onTrail }) {
  const [result, setResult] = useState('');
  const { data, loading, error } = useFetch(() => analytics.get(`/scans${qs({ result })}`), [result]);
  const toast = useToast();
  return (
    <div className="card">
      <div className="card-head">
        <select className="select" style={{ width: 220 }} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>{['ACCEPTED', 'REJECTED_DUPLICATE', 'REJECTED_INVALID', 'REJECTED_NOT_LIVE'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={() => analytics.download(`/scans${qs({ result })}`, 'gate-scans.csv').catch((e) => toast.error(e.message))}><Download size={15} />CSV</button>
      </div>
      {loading ? <Loading /> : error ? <ErrorState error={error} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Time (ms)</th><th>Festival</th><th>Gate</th><th>Dir.</th><th>Result</th><th>Holder</th><th>Staff</th><th /></tr></thead>
          <tbody>{data.scans.slice(0, 300).map((s) => (
            <tr key={s.scan_id}><td className="mono tiny nowrap">{s.scanned_at}</td><td className="small">{s.festival_name}</td><td className="mono">{s.gate_code}</td><td><Badge value={s.direction} /></td><td><Badge value={s.result} /></td><td className="small">{s.holder_name}</td><td className="small">{s.staff_name}</td>
              <td className="right"><button className="btn btn-ghost btn-sm" onClick={() => onTrail(s.ticket_id)}><FileSearch size={14} /></button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export default function Audit() {
  const [tab, setTab] = useState('lookup');
  const [trail, setTrail] = useState(null);
  const [lookup, setLookup] = useState('');
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookup.trim());
  return (
    <>
      <div className="page-head"><div><h1>Audit trail</h1><p>Who bought a ticket, who received it, and where and when it was scanned.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'lookup', label: 'Ticket lookup', icon: Search }, { id: 'transfers', label: 'Transfers', icon: Repeat }, { id: 'scans', label: 'Gate scans', icon: ScanLine }]} />
      {tab === 'lookup' && (
        <form className="card card-pad stack" onSubmit={(e) => { e.preventDefault(); if (valid) setTrail(lookup.trim()); }}>
          <p className="muted small">Paste a ticket ID (shown on attendee lists, transfers and scans) to reconstruct its full history, for example when a ticket is reported stolen.</p>
          <div className="row"><input className="input mono" style={{ flex: 1 }} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={lookup} onChange={(e) => setLookup(e.target.value)} /><button className="btn btn-primary" disabled={!valid}><FileSearch size={15} />Look up</button></div>
          <Alert>Tip: open the Transfers or Gate scans tab and use the trail button on any row.</Alert>
        </form>
      )}
      {tab === 'transfers' && <Transfers onTrail={setTrail} />}
      {tab === 'scans' && <Scans onTrail={setTrail} />}
      {trail && <TrailModal ticketId={trail} onClose={() => setTrail(null)} />}
    </>
  );
}
