import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, CheckCircle2, XCircle, AlertTriangle, LogIn, LogOut, Keyboard, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { Badge, Field, Loading } from '../../components/ui';
import { time } from '../../lib/format';

const GATE_KEY = 'festpass.gate';

function ResultCard({ r }) {
  const ok = r.result === 'ACCEPTED';
  const dup = r.result === 'REJECTED_DUPLICATE';
  const Icon = ok ? CheckCircle2 : dup ? AlertTriangle : XCircle;
  return (
    <div className={`scan-result ${ok ? 'ok' : dup ? 'warn' : 'bad'}`}>
      <Icon size={54} />
      <h2>{ok ? (r.direction === 'OUT' ? 'EXIT OK' : 'ADMIT') : 'REFUSE'}</h2>
      <p>{r.message}</p>
      {r.ticket && <div className="who"><b>{r.ticket.holder_name}</b><br /><span className="small">{r.ticket.tier_name} · {r.ticket.festival_name}</span></div>}
      {r.previous_scan && !ok && <p className="small mt-1">Last accepted: {r.previous_scan.direction} at {r.previous_scan.gate_code}, {time(r.previous_scan.scanned_at)}</p>}
    </div>
  );
}

export default function Scanner() {
  const fests = useFetch(() => api.get('/scans/festivals'), []);
  const recent = useFetch(() => api.get('/scans/recent'), []);
  const saved = (() => { try { return JSON.parse(localStorage.getItem(GATE_KEY) || '{}'); } catch { return {}; } })();
  const [festivalId, setFestivalId] = useState(saved.festivalId || '');
  const [gate, setGate] = useState(saved.gate || 'NORTH-1');
  const [direction, setDirection] = useState('IN');
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState(null);
  const scanner = useRef(null);
  const busy = useRef(false);
  const settings = useRef({});
  settings.current = { festivalId, gate, direction };

  useEffect(() => {
    try { localStorage.setItem(GATE_KEY, JSON.stringify({ festivalId, gate })); } catch { /* ignore */ }
  }, [festivalId, gate]);

  useEffect(() => {
    if (!festivalId && fests.data?.festivals?.length) {
      const live = fests.data.festivals.find((f) => f.status === 'LIVE') || fests.data.festivals[0];
      setFestivalId(String(live.festival_id));
    }
  }, [fests.data, festivalId]);

  const submit = useCallback(async (raw) => {
    const token = String(raw || '').trim().toLowerCase();
    if (!token || busy.current) return;
    busy.current = true;
    const s = settings.current;
    try {
      const r = await api.post('/scans', { qr_token: token, gate_code: s.gate, direction: s.direction, festival_id: s.festivalId ? Number(s.festivalId) : undefined });
      setResult({ ...r, direction: s.direction });
      if (navigator.vibrate) navigator.vibrate(r.result === 'ACCEPTED' ? 80 : [60, 60, 60]);
    } catch (e) {
      setResult({ result: 'REJECTED_INVALID', message: e.message, direction: s.direction });
    } finally {
      recent.reload(true);
      fests.reload(true);
      setTimeout(() => { busy.current = false; }, 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCam = useCallback(async () => {
    if (scanner.current) {
      try { await scanner.current.stop(); } catch { /* not running */ }
      try { scanner.current.clear(); } catch { /* ignore */ }
      scanner.current = null;
    }
    setCamOn(false);
  }, []);

  const startCam = async () => {
    setCamError(null);
    try {
      const s = new Html5Qrcode('qr-reader', { verbose: false });
      scanner.current = s;
      await s.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text) => submit(text), () => {});
      setCamOn(true);
    } catch (e) {
      setCamError('Camera unavailable. Allow camera access, or type/paste the code below.');
      scanner.current = null;
      setCamOn(false);
    }
  };

  useEffect(() => () => { stopCam(); }, [stopCam]);

  if (fests.loading) return <Loading />;
  const festival = fests.data?.festivals.find((f) => String(f.festival_id) === String(festivalId));

  return (
    <div className="scanner-shell stack">
      <div className="row-between">
        <div><h1>Gate scanner</h1><p className="muted small">Scan each QR code; the screen shows admit or refuse.</p></div>
        {festival && <span className="badge blue plain"><Users size={13} />{festival.inside_now} inside</span>}
      </div>

      <div className="card card-pad stack">
        <div className="form-grid">
          <Field label="Festival">
            <select className="select" value={festivalId} onChange={(e) => setFestivalId(e.target.value)}>
              {fests.data.festivals.map((f) => <option key={f.festival_id} value={f.festival_id}>{f.name}{f.status === 'LIVE' ? ' (live)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Gate"><input className="input mono" value={gate} maxLength={10} onChange={(e) => setGate(e.target.value.toUpperCase())} /></Field>
        </div>
        <div className="segmented" style={{ alignSelf: 'stretch', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <button className={direction === 'IN' ? 'on' : ''} onClick={() => setDirection('IN')}><LogIn size={15} style={{ verticalAlign: -3, marginRight: 6 }} />Entry (IN)</button>
          <button className={direction === 'OUT' ? 'on' : ''} onClick={() => setDirection('OUT')}><LogOut size={15} style={{ verticalAlign: -3, marginRight: 6 }} />Exit (OUT)</button>
        </div>
        {festival && festival.status !== 'LIVE' && <p className="small" style={{ color: 'var(--warning)' }}>This festival is not live, so entries will be refused.</p>}
      </div>

      {result && <ResultCard r={result} />}

      <div className="scan-view">
        <div id="qr-reader" />
        {!camOn && (
          <div className="center stack-sm" style={{ position: 'absolute', padding: 20 }}>
            <Camera size={40} style={{ margin: '0 auto' }} />
            <p className="small">Camera is off</p>
            {camError && <p className="small" style={{ color: '#fca5a5' }}>{camError}</p>}
          </div>
        )}
      </div>
      <button className={`btn ${camOn ? 'btn-outline' : 'btn-grad'} btn-lg`} onClick={camOn ? stopCam : startCam}>
        {camOn ? <><CameraOff size={18} />Stop camera</> : <><Camera size={18} />Start camera</>}
      </button>

      <form className="card card-pad stack-sm" onSubmit={(e) => { e.preventDefault(); busy.current = false; submit(manual); setManual(''); }}>
        <label className="small bold row"><Keyboard size={15} />Manual entry / handheld scanner</label>
        <div className="row">
          <input className="input mono" style={{ flex: 1 }} placeholder="64-character QR code" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn btn-primary">Check</button>
        </div>
      </form>

      <div className="card">
        <div className="card-head"><h3>My recent scans</h3></div>
        <div className="table-wrap"><table className="table">
          <tbody>{(recent.data?.scans || []).slice(0, 12).map((s) => (
            <tr key={s.scan_id}>
              <td className="mono small">{time(s.scanned_at)}</td>
              <td>{s.holder_name}<div className="tiny muted">{s.tier_name}</div></td>
              <td><Badge value={s.direction} /></td>
              <td className="right"><Badge value={s.result} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        {!recent.data?.scans?.length && <p className="small muted card-pad">No scans yet this shift.</p>}
      </div>
    </div>
  );
}
