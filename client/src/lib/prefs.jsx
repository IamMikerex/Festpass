import { createContext, useContext, useEffect, useState } from 'react';

// Look-and-feel preferences, saved in this browser. index.html applies them before first paint.
const KEY = 'festpass.prefs';
export const DEFAULTS = { theme: 'purple', logo: 'ticket', bg: 'beams', motion: 'calm', glow: true, tilt: true };
export const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return DEFAULTS; } };

function apply(p) {
  const d = document.documentElement.dataset;
  Object.assign(d, { theme: p.theme, bg: p.bg, motion: p.motion, glow: p.glow ? 'on' : 'off', tilt: p.tilt ? 'on' : 'off' });
}

// Cursor light + card tilt: one delegated, rAF-throttled listener writes CSS variables on the hovered surface.
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
      if (last && last !== el) last.style.removeProperty('--rx'), last.style.removeProperty('--ry');
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
  useEffect(() => {
    apply(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  }, [prefs]);
  useEffect(trackPointer, []);
  const set = (patch) => setPrefs((p) => ({ ...p, ...patch }));
  const reset = () => setPrefs(DEFAULTS);
  return <PrefsContext.Provider value={{ prefs, set, reset }}>{children}</PrefsContext.Provider>;
}
export const usePrefs = () => useContext(PrefsContext);
