import { createContext, useContext, useEffect, useState } from 'react';

// Look-and-feel + accessibility preferences, saved in this browser.
// index.html runs the same load + apply before first paint (keep DEFAULTS and CHOICES in sync there).
const KEY = 'festpass.prefs';
export const DEFAULTS = {
  v: 3, theme: 'sunset', bg: 'beams', motion: 'calm', glow: true, tilt: true,
  reduce: 'system', contrast: false, text: 'md', focus: false, simple: false,
};
// reduce: 'system' follows the OS prefers-reduced-motion setting; 'on' / 'off' are the user's explicit choice.
const CHOICES = {
  theme: ['sunset', 'purple', 'pink', 'blue', 'rainbow'], bg: ['beams', 'aurora', 'minimal'],
  motion: ['off', 'calm', 'lively'], reduce: ['system', 'on', 'off'], text: ['sm', 'md', 'lg', 'xl'],
};

/** Saved prefs merged over DEFAULTS; unknown or corrupt values fall back to the default. */
export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    if (!saved.v && saved.theme === 'purple' && saved.bg === 'beams' && saved.motion === 'calm') delete saved.theme; // v1 saved the old default on every visit
    if (typeof saved.reduce === 'boolean') saved.reduce = saved.reduce ? 'on' : 'system'; // v2 stored a boolean
    const p = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      const ok = CHOICES[k] ? CHOICES[k].includes(saved[k]) : typeof saved[k] === typeof DEFAULTS[k];
      if (k !== 'v' && ok) p[k] = saved[k];
    }
    return p;
  } catch { return { ...DEFAULTS }; }
}

const MQ = '(prefers-reduced-motion: reduce)';
const osReduce = () => matchMedia(MQ).matches;
export const isStill = (p, os) => p.reduce === 'on' || (p.reduce === 'system' && os);

/** What the page actually uses: accessibility choices (and the OS) override the visual ones. */
export function effective(p, os = osReduce()) {
  const still = isStill(p, os);
  const fx = !p.simple && !still;
  return {
    theme: p.theme, bg: p.simple ? 'minimal' : p.bg, text: p.text,
    motion: still ? 'off' : p.motion,
    glow: p.glow && fx ? 'on' : 'off',
    tilt: p.tilt && fx ? 'on' : 'off',
    reduce: still ? 'on' : 'off',
    fx: p.simple ? 'off' : 'on',
    contrast: p.contrast ? 'high' : 'normal',
    focus: p.focus ? 'strong' : 'normal',
  };
}

// Cursor light + card tilt: one delegated, rAF-throttled listener moves the stage light and writes CSS variables on
// the hovered surface. CSS only uses them when html[data-glow|data-tilt] is "on". Touch screens get neither.
const SURFACES = '.card, .fest-card, .stat, .ticket, .filters';
function trackPointer() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  const html = document.documentElement;
  let frame = 0;
  let last = null;
  const onMove = (e) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const on = html.dataset.glow === 'on';
      const tilt = html.dataset.tilt === 'on';
      const light = document.querySelector('.cursor-light');
      if (light) light.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      const el = (on || tilt) && e.target.closest?.(SURFACES);
      if (last && last !== el) { last.style.removeProperty('--rx'); last.style.removeProperty('--ry'); }
      last = el || null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      el.style.setProperty('--mx', `${x}px`);
      el.style.setProperty('--my', `${y}px`);
      if (tilt && el.classList.contains('fest-card')) {
        el.style.setProperty('--rx', `${((y / r.height) - 0.5) * -5}deg`);
        el.style.setProperty('--ry', `${((x / r.width) - 0.5) * 6}deg`);
      }
    });
  };
  const onLeave = (e) => { if (!e.relatedTarget) document.querySelector('.cursor-light')?.style.removeProperty('transform'); };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerout', onLeave);
  return () => { window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerout', onLeave); cancelAnimationFrame(frame); };
}

const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked: keep the in-memory choice */ } return p; };

const PrefsContext = createContext(null);
export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(load);
  const [os, setOs] = useState(osReduce);
  useEffect(() => {
    const mq = matchMedia(MQ);
    const onChange = () => setOs(mq.matches);
    mq.addEventListener('change', onChange);
    // Another tab changed the settings: follow it.
    const onStorage = (e) => e.key === KEY && setPrefs(load());
    window.addEventListener('storage', onStorage);
    return () => { mq.removeEventListener('change', onChange); window.removeEventListener('storage', onStorage); };
  }, []);
  useEffect(() => { Object.assign(document.documentElement.dataset, effective(prefs, os)); }, [prefs, os]);
  useEffect(trackPointer, []);
  // Only explicit changes are saved, so first-time visitors keep following DEFAULTS.
  const set = (patch) => setPrefs((p) => save({ ...p, ...patch }));
  const reset = () => { try { localStorage.removeItem(KEY); } catch { /* blocked storage */ } setPrefs({ ...DEFAULTS }); };
  return <PrefsContext.Provider value={{ prefs, set, reset, os, still: isStill(prefs, os) }}>{children}</PrefsContext.Provider>;
}
export const usePrefs = () => useContext(PrefsContext);
