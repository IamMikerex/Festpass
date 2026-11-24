import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { usePrefs } from '../lib/prefs';
import Logo from './Logo';

const THEMES = [['purple', 'Electric purple'], ['pink', 'Neon pink'], ['blue', 'Cyber blue'], ['sunset', 'Sunset orange'], ['rainbow', 'Festival rainbow']];
const LOGOS = [['ticket', 'Ticket'], ['stage', 'Stage'], ['outline', 'Outline']];
const LIGHTS = [['beams', 'Beams'], ['aurora', 'Aurora'], ['minimal', 'Minimal']];
const MOTION = [['off', 'Still'], ['calm', 'Calm'], ['lively', 'Lively']];

function Segment({ label, options, value, onChange }) {
  return (
    <div className="pref">
      <span className="pref-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, t]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{t}</button>)}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="switch-row">
      <span><b>{label}</b><small>{hint}</small></span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function Customizer() {
  const { prefs, set, reset } = usePrefs();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => !box.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="customizer" ref={box}>
      <button className={`btn btn-ghost btn-icon ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Customize look" aria-expanded={open} title="Customize look">
        <SlidersHorizontal size={18} />
      </button>
      {open && (
        <div className="pref-panel" role="dialog" aria-label="Customize look">
          <div className="row-between"><h3>Your stage</h3><button className="btn btn-ghost btn-sm" onClick={reset}><RotateCcw size={14} /> Reset</button></div>
          <div className="pref">
            <span className="pref-label">Colour</span>
            <div className="swatches" role="radiogroup" aria-label="Colour">
              {THEMES.map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={prefs.theme === v} aria-label={t} title={t} className={`swatch sw-${v} ${prefs.theme === v ? 'on' : ''}`} onClick={() => set({ theme: v })} />
              ))}
            </div>
            <span className="tiny muted">{THEMES.find(([v]) => v === prefs.theme)[1]}</span>
          </div>
          <div className="pref">
            <span className="pref-label">Logo</span>
            <div className="logo-picks" role="radiogroup" aria-label="Logo">
              {LOGOS.map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={prefs.logo === v} className={prefs.logo === v ? 'on' : ''} onClick={() => set({ logo: v })}><Logo variant={v} size={28} />{t}</button>
              ))}
            </div>
          </div>
          <Segment label="Lighting" options={LIGHTS} value={prefs.bg} onChange={(bg) => set({ bg })} />
          <Segment label="Motion" options={MOTION} value={prefs.motion} onChange={(motion) => set({ motion })} />
          <div className="pref">
            <Toggle label="Cursor light" hint="Panels glow where you point" checked={prefs.glow} onChange={(glow) => set({ glow })} />
            <Toggle label="Card tilt" hint="Festival cards lean toward the cursor" checked={prefs.tilt} onChange={(tilt) => set({ tilt })} />
          </div>
          <p className="tiny faint">Saved in this browser. Your device's reduce-motion setting always wins.</p>
        </div>
      )}
    </div>
  );
}
