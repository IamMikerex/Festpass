import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MapPinned, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import StallMap from '../../components/StallMap';
import { Alert, Empty, ErrorState, Field, Loading, Modal, useToast } from '../../components/ui';
import { dateRange, label, money } from '../../lib/format';

function ApplyModal({ stall, festival, eligibility, onClose, onDone }) {
  const eligible = eligibility.filter((e) => e.eligible);
  const [vendorId, setVendorId] = useState(eligible[0]?.vendor_id || '');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/allocations', { vendor_id: Number(vendorId), stall_id: stall.stall_id }); toast.success(`Applied for ${stall.stall_code}`); onDone(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={`Apply for stall ${stall.stall_code}`} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!vendorId || busy} onClick={submit}>{busy ? 'Applying…' : 'Submit application'}</button>
    </>}>
      <div className="stack">
        <div className="card card-pad">
          <div className="summary-line"><span>Festival</span><b>{festival.name}</b></div>
          <div className="summary-line"><span>Zone</span><span>{label(stall.zone)}</span></div>
          <div className="summary-line"><span>Size</span><span>{Number(stall.size_m2)} m² {stall.has_power ? '· power' : ''}</span></div>
          <div className="summary-line"><span>Base fee</span><b>{money(stall.base_fee)}</b></div>
        </div>
        <Field label="Apply as">
          <div className="stack-sm">
            {eligibility.map((e) => (
              <label key={e.vendor_id} className="tier" style={{ padding: 12, cursor: e.eligible ? 'pointer' : 'not-allowed', opacity: e.eligible ? 1 : 0.7 }}>
                <input type="radio" name="vendor" disabled={!e.eligible} checked={String(vendorId) === String(e.vendor_id)} onChange={() => setVendorId(e.vendor_id)} />
                <div className="tier-info">
                  <b>{e.legal_name}</b>
                  {e.eligible ? <div className="tiny" style={{ color: 'var(--success)' }}><CheckCircle2 size={12} style={{ verticalAlign: -2 }} /> Eligible</div>
                    : <div className="tiny" style={{ color: 'var(--danger)' }}><XCircle size={12} style={{ verticalAlign: -2 }} /> {e.problems.join('; ')}</div>}
                </div>
              </label>
            ))}
          </div>
        </Field>
        <p className="small muted">After approval you have 7 days to pay the agreed fee, or the allocation is cancelled automatically. Cancelling a paid stall less than 21 days before the festival forfeits 50% of the fee.</p>
        {err && <Alert kind="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

export default function StallMarket() {
  const [params, setParams] = useSearchParams();
  const fests = useFetch(() => api.get('/festivals'), []);
  const festivalId = params.get('festival');
  const map = useFetch(() => (festivalId ? api.get(`/festivals/${festivalId}/stalls`) : Promise.resolve(null)), [festivalId]);
  const mine = useFetch(() => api.get('/allocations/mine'), []);
  const [pick, setPick] = useState(null);

  useEffect(() => {
    if (!festivalId && fests.data?.festivals?.length) {
      const first = fests.data.festivals.find((f) => f.status === 'ON_SALE' && f.stall_count > 0) || fests.data.festivals[0];
      setParams({ festival: first.festival_id }, { replace: true });
    }
  }, [festivalId, fests.data, setParams]);

  if (fests.loading) return <Loading />;
  if (fests.error) return <ErrorState error={fests.error} />;
  const myApproved = (mine.data?.allocations || []).filter((a) => a.status === 'APPROVED').map((a) => a.stall_id);
  const noVendors = map.data?.eligibility && map.data.eligibility.length === 0;

  return (
    <>
      <div className="page-head">
        <div><h1>Find a stall</h1><p>Pick a festival, then a free spot on its site map.</p></div>
        <select className="select" style={{ width: 300 }} value={festivalId || ''} onChange={(e) => setParams({ festival: e.target.value })}>
          {fests.data.festivals.map((f) => <option key={f.festival_id} value={f.festival_id}>{f.name} · {dateRange(f.start_date, f.end_date)} · {f.stall_count} stalls</option>)}
        </select>
      </div>
      {noVendors && <div className="mb-2"><Alert kind="warning">Register a business first. <Link to="/vendor">Go to My businesses</Link></Alert></div>}
      {map.loading ? <Loading /> : map.error ? <ErrorState error={map.error} /> : !map.data ? null : (
        <div className="detail-grid">
          <div className="card card-pad">
            {map.data.stalls.length === 0 ? <Empty icon={MapPinned} title="No stalls published yet" /> : (
              <StallMap stalls={map.data.stalls} mineIds={myApproved} selected={pick?.stall_id}
                onPick={(s) => (!s.approved_vendor && !noVendors ? setPick(s) : null)} />
            )}
          </div>
          <div className="card sticky">
            <div className="card-head"><h3>Your eligibility</h3></div>
            <div className="card-body stack-sm">
              <p className="small muted">{map.data.festival.name} ends {dateRange(map.data.festival.end_date, map.data.festival.end_date)}. Permits must be valid through that day.</p>
              {(map.data.eligibility || []).map((e) => (
                <div key={e.vendor_id} className="small">
                  <b>{e.legal_name}</b>: {e.eligible ? <span style={{ color: 'var(--success)' }}>eligible</span> : <span style={{ color: 'var(--danger)' }}>{e.problems.join('; ')}</span>}
                </div>
              ))}
              <div className="divider" />
              <p className="small muted">Each stall can go to one vendor, and each vendor can hold at most 2 approved stalls per festival.</p>
            </div>
          </div>
        </div>
      )}
      {pick && <ApplyModal stall={pick} festival={map.data.festival} eligibility={map.data.eligibility || []} onClose={() => setPick(null)} onDone={() => { setPick(null); map.reload(true); mine.reload(true); }} />}
    </>
  );
}
