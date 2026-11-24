import { useEffect, useId, useRef, useState } from 'react';
import { SlidersHorizontal, RotateCcw, Accessibility, Pause, Contrast, Type, Focus, Sparkles, MousePointer2, Move3d } from 'lucide-react';
import { usePrefs } from '../lib/prefs';
import Logo from './Logo';

const THEMES = [['sunset', 'Sunset orange'], ['purple', 'Electric purple'], ['pink', 'Neon pink'], ['blue', 'Cyber blue'], ['rainbow', 'Festival rainbow']];
const LOGOS = [['ticket', 'Ticket'], ['stage', 'Stage'], ['outline', 'Outline']];
const LIGHTS = [['beams', 'Beams'], ['aurora', 'Aurora'], ['minimal', 'Minimal']];
const MOTION = [['off', 'Still'], ['calm', 'Calm'], ['lively', 'Lively']];
const TEXT = [['sm', 'Small'], ['md', 'Default'], ['lg', 'Large'], ['xl', 'X-large']];

function Segment({ label, options, value, onChange, disabled, note }) {
  return (
    <fieldset className="pref" disabled={disabled}>
      <legend className="pref-label">{label}</legend>
      <div className="segmented">
        {options.map(([v, t]) => (
          <button key={v} type="button" aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{t}</button>
        ))}
      </div>
      {note && <small className="pref-note">{note}</small>}
    </fieldset>
  );
}

function Toggle({ icon: Icon, label, hint, checked, onChange, disabled, note }) {
  const id = useId();
  return (
    <div className={`switch-row ${disabled ? 'is-off' : ''}`}>
      {Icon && <Icon size={18} className="switch-ic" aria-hidden="true" />}
      <label htmlFor={id}><b>{label}</b><small id={`${id}-d`}>{note || hint}</small></label>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled}
        aria-describedby={`${id}-d`} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export default function Customizer() {
  const { prefs, set, reset, os } = usePrefs();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const btn = useRef(null);
  const panel = useRef(null);
  const panelId = useId();
  const close = (refocus) => { setOpen(false); if (refocus) btn.current?.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus();
    const away = (e) => !box.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && close(true);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const still = prefs.reduce || os;
  const fxNote = prefs.simple ? 'Off while visual effects are disabled' : still ? 'Off while motion is reduced' : null;

  return (
    <div className="customizer" ref={box}>
      <button ref={btn} className={`btn btn-ghost btn-icon ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)}
        aria-label="Appearance and accessibility settings" aria-expanded={open} aria-controls={panelId} title="Appearance and accessibility">
        <SlidersHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <section id={panelId} ref={panel} tabIndex={-1} className="pref-panel" role="dialog" aria-labelledby={`${panelId}-t`}>
          <div className="row-between">
            <h2 id={`${panelId}-t`}>Your stage</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset} aria-label="Reset all settings to the defaults"><RotateCcw size={14} aria-hidden="true" /> Reset</button>
          </div>

          <fieldset className="pref">
            <legend className="pref-label">Colour</legend>
            <div className="swatches">
              {THEMES.map(([v, t]) => (
                <button key={v} type="button" aria-pressed={prefs.theme === v} aria-label={t} title={t} className={`swatch sw-${v} ${prefs.theme === v ? 'on' : ''}`} onClick={() => set({ theme: v })} />
              ))}
            </div>
            <span className="tiny muted" aria-live="polite">{THEMES.find(([v]) => v === prefs.theme)?.[1]}</span>
          </fieldset>
          <fieldset className="pref">
            <legend className="pref-label">Logo</legend>
            <div className="logo-picks">
              {LOGOS.map(([v, t]) => (
                <button key={v} type="button" aria-pressed={prefs.logo === v} className={prefs.logo === v ? 'on' : ''} onClick={() => set({ logo: v })}><Logo variant={v} size={28} />{t}</button>
              ))}
            </div>
          </fieldset>
          <Segment label="Lighting" options={LIGHTS} value={prefs.bg} onChange={(bg) => set({ bg })} />
          <Segment label="Motion" options={MOTION} value={still ? 'off' : prefs.motion} onChange={(motion) => set({ motion })}
            disabled={still} note={still ? 'Still while Reduce motion is on' : null} />
          <div className="pref">
            <Toggle icon={MousePointer2} label="Cursor light" hint="Panels glow where you point" checked={prefs.glow && !fxNote} disabled={!!fxNote} note={fxNote} onChange={(glow) => set({ glow })} />
            <Toggle icon={Move3d} label="Card tilt" hint="Festival cards lean toward the cursor" checked={prefs.tilt && !fxNote} disabled={!!fxNote} note={fxNote} onChange={(tilt) => set({ tilt })} />
          </div>

          <div className="pref-section" role="group" aria-labelledby={`${panelId}-a`}>
            <h3 id={`${panelId}-a`}><Accessibility size={16} aria-hidden="true" /> Accessibility</h3>
            <Toggle icon={Pause} label="Reduce motion" hint="Stops moving lights, specks, tilt and page animations"
              checked={still} disabled={os} note={os ? 'On because your device asks for reduced motion' : null} onChange={(reduce) => set({ reduce })} />
            <Toggle icon={Contrast} label="High contrast" hint="Brighter text, stronger borders and clearer controls" checked={prefs.contrast} onChange={(contrast) => set({ contrast })} />
            <Toggle icon={Focus} label="Bold focus outline" hint="Thick yellow outline on whatever the keyboard is on" checked={prefs.focus} onChange={(focus) => set({ focus })} />
            <Toggle icon={Sparkles} label="Disable visual effects" hint="No glow, cursor light, tilt, specks or animated lighting" checked={prefs.simple} onChange={(simple) => set({ simple })} />
            <Segment label={<><Type size={13} aria-hidden="true" /> Text size</>} options={TEXT} value={prefs.text} onChange={(text) => set({ text })} />
          </div>
          <p className="tiny faint">Saved in this browser.</p>
        </section>
      )}
    </div>
  );
}
