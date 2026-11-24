import { createContext, useContext, useEffect, useState } from 'react';

// Look-and-feel + accessibility preferences, saved in this browser.
// index.html runs the same load + apply before first paint (keep DEFAULTS in sync there).
const KEY = 'festpass.prefs';
export const DEFAULTS = {
  v: 2, theme: 'sunset', logo: 'ticket', bg: 'beams', motion: 'calm', glow: true, tilt: true,
  reduce: false, contrast: false, text: 'md', focus: false, simple: false,
};
// Before v2 the full default set was saved on every visit, so an unversioned copy of the old defaults is not a real choice.
const untouchedV1 = (p) => !p.v && p.theme === 'purple' && p.logo === 'ticket' && p.bg === 'beams' && p.motion === 'calm' && p.glow !== false && p.tilt !== false;

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    return { ...DEFAULTS, ...(untouchedV1(saved) ? {} : saved), v: 2 };
  } catch { return DEFAULTS; }
}

const osReduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What the page actually uses: accessibility choices (and the OS) override the visual ones. */
export function effective(p, os = osReduce()) {
  const still = p.reduce || os;
  return {
    theme: p.theme, bg: p.bg, text: p.text,
    motion: still ? 'off' : p.motion,
    glow: p.glow && !p.simple && !still ? 'on' : 'off',
    tilt: p.tilt && !p.simple && !still ? 'on' : 'off',
    reduce: still ? 'on' : 'off',
    fx: p.simple ? 'off' : 'on',
    contrast: p.contrast ? 'high' : 'normal',
    focus: p.focus ? 'strong' : 'normal',
  };
}

const apply = (p) => Object.assign(document.documentElement.dataset, effective(p));

// Cursor light + card tilt: one delegated, rAF-throttled listener writes CSS variables on the hovered surface.
// CSS only uses them when html[data-glow|data-tilt] is "on".
const SURFACES = '.card, .fest-card, .stat, .ticket, .filters';
function trackPointer() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  let frame = 0;
  let last = null;
  const onMove = (e) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const el = e.target.closest?.(SURFACES);
      if (last && last !== el) { last.style.removeProperty('--rx'); last.style.removeProperty('--ry'); }
      last = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      el.style.setProperty('--mx', `${x}px`);
      el.style.setProperty('--my', `${y}px`);
      if (el.classList.contains('fest-card')) {
        el.style.setProperty('--rx', `${((y / r.height) - 0.5) * -5}deg`);
        el.style.setProperty('--ry', `${((x / r.width) - 0.5) * 6}deg`);
      }
    });
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(frame); };
}

const PrefsContext = createContext(null);
export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(load);
  const [os, setOs] = useState(osReduce);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOs(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => { apply(prefs); }, [prefs, os]);
  useEffect(trackPointer, []);
  const save = (next) => { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } return next; };
  // Only explicit changes are saved, so first-time visitors keep following DEFAULTS.
  const set = (patch) => setPrefs((p) => save({ ...p, ...patch }));
  const reset = () => setPrefs(save(DEFAULTS));
  return <PrefsContext.Provider value={{ prefs, set, reset, os }}>{children}</PrefsContext.Provider>;
}
export const usePrefs = () => useContext(PrefsContext);
