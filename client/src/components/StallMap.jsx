import { Zap } from 'lucide-react';
import { label, money } from '../lib/format';

const ZONES = ['FOOD_COURT', 'MAIN_STAGE', 'CAMPING', 'ENTRANCE'];

/** Site map grouped by zone. onPick(stall) is called for selectable stalls. */
export default function StallMap({ stalls, selected, onPick, mineIds = [], showVendor }) {
  return (
    <div>
      <div className="legend mb-2">
        <span><i />Available</span>
        <span><i style={{ background: 'repeating-linear-gradient(-45deg,rgba(255,255,255,.03),rgba(255,255,255,.03) 3px,rgba(255,255,255,.14) 3px,rgba(255,255,255,.14) 6px)' }} />Allocated</span>
        <span><i style={{ borderColor: 'var(--success)', background: 'var(--success-50)' }} />Yours</span>
        <span><Zap size={12} style={{ verticalAlign: -2 }} /> Power supply</span>
      </div>
      {ZONES.map((z) => {
        const list = stalls.filter((s) => s.zone === z);
        if (!list.length) return null;
        return (
          <div className="zone" key={z}>
            <div className="zone-title">{label(z)} <span className="faint">· {list.length}</span></div>
            <div className="stall-grid">
              {list.map((s) => {
                const mine = mineIds.includes(s.stall_id);
                const taken = !!s.approved_vendor && !mine;
                return (
                  <button key={s.stall_id} type="button" className={`stall ${taken ? 'taken' : ''} ${mine ? 'mine' : ''} ${selected === s.stall_id ? 'selected' : ''}`}
                    disabled={!onPick || (taken && !showVendor)} onClick={() => onPick && onPick(s)}>
                    <div className="row-between"><span className="stall-code">{s.stall_code}</span>{!!s.has_power && <Zap size={14} color="var(--warning)" />}</div>
                    <small>{Number(s.size_m2)} m² · {money(s.base_fee)}</small>
                    <small style={{ marginTop: 4, fontWeight: 600, color: taken ? 'var(--muted)' : mine ? 'var(--success)' : 'var(--primary)' }}>
                      {s.approved_vendor ? (showVendor || mine ? s.approved_vendor : 'Allocated') : s.open_applications ? `${s.open_applications} applied` : 'Available'}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
