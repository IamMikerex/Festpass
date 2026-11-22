import { useId, useMemo, useState } from 'react';
import { festivalPhoto } from '../lib/media';

// Night-time festival poster art, generated deterministically per festival:
// a glowing sun, stage light beams, lasers and a crowd silhouette.
// A photo (if available) fades in on top; the art stays as the fallback.
const PALETTES = [
  { sky: ['#12032a', '#3b0764'], sun: ['#fdf4ff', '#e879f9', '#a855f7'], beam: '#c084fc', laser: '#f472b6' },
  { sky: ['#1f0414', '#5b0b3a'], sun: ['#fff7ed', '#fb923c', '#f43f5e'], beam: '#fb7185', laser: '#fdba74' },
  { sky: ['#030a22', '#1e1b4b'], sun: ['#ecfeff', '#67e8f9', '#6366f1'], beam: '#818cf8', laser: '#22d3ee' },
  { sky: ['#1a0701', '#4a1405'], sun: ['#fefce8', '#fbbf24', '#f97316'], beam: '#fb923c', laser: '#f472b6' },
  { sky: ['#0a0320', '#2e1065'], sun: ['#fdf2f8', '#f472b6', '#d946ef'], beam: '#e879f9', laser: '#a78bfa' },
  { sky: ['#02141a', '#0c3a4a'], sun: ['#f0fdfa', '#5eead4', '#0ea5e9'], beam: '#5eead4', laser: '#e879f9' },
];

function Poster({ id, name }) {
  const uid = useId().replace(/:/g, '');
  const p = PALETTES[Math.abs(Number(id) || 0) % PALETTES.length];
  const shapes = useMemo(() => {
    const seed = (Number(id) || 1) * 9301 + (name || '').length * 49297;
    const r = (n) => { const x = Math.sin(seed + n * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const sunX = 260 + r(1) * 280;
    const beams = Array.from({ length: 7 }, (_, i) => {
      const x = 140 + i * 88 + (r(10 + i) - 0.5) * 30;
      const tx = x + (r(20 + i) - 0.5) * 520;
      return { x, tx, o: 0.18 + r(30 + i) * 0.22 };
    });
    const lasers = Array.from({ length: 9 }, (_, i) => ({ x2: r(40 + i) * 800, y2: -10 + r(50 + i) * 120 }));
    const stars = Array.from({ length: 46 }, (_, i) => ({ x: r(60 + i) * 800, y: r(110 + i) * 220, s: 0.6 + r(160 + i) * 1.4, o: 0.25 + r(210 + i) * 0.6 }));
    // crowd silhouette: heads, shoulders and some raised hands
    let crowd = 'M0 450 L0 392 ';
    const hands = [];
    for (let x = -6, i = 0; x < 820; x += 11 + r(300 + i) * 9, i += 1) {
      const h = 378 + r(400 + i) * 22;
      crowd += `L${x} ${h + 14} Q${x + 2} ${h} ${x + 8} ${h} Q${x + 14} ${h} ${x + 16} ${h + 14} `;
      if (r(500 + i) > 0.82) hands.push({ x: x + 8, y: h - 26 - r(600 + i) * 18, a: (r(700 + i) - 0.5) * 30 });
    }
    crowd += 'L800 450 Z';
    return { sunX, beams, lasers, stars, crowd, hands };
  }, [id, name]);

  return (
    <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} /><stop offset="0.75" stopColor={p.sky[1]} /><stop offset="1" stopColor={p.sky[1]} />
        </linearGradient>
        <radialGradient id={`${uid}u`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={p.sun[0]} /><stop offset="0.45" stopColor={p.sun[1]} /><stop offset="1" stopColor={p.sun[2]} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}h`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={p.sun[1]} stopOpacity="0.55" /><stop offset="1" stopColor={p.sun[2]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}b`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={p.beam} stopOpacity="0.9" /><stop offset="1" stopColor={p.beam} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill={`url(#${uid}s)`} />
      {shapes.stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#fff" opacity={s.o} />)}
      <circle cx={shapes.sunX} cy="250" r="260" fill={`url(#${uid}h)`} />
      <circle cx={shapes.sunX} cy="250" r="120" fill={`url(#${uid}u)`} />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={shapes.sunX - 130} y={262 + i * 14} width="260" height={3 + i} fill={p.sky[1]} opacity="0.85" />)}
      <g style={{ mixBlendMode: 'screen' }}>
        {shapes.beams.map((b, i) => (
          <polygon key={i} points={`${b.x - 5},330 ${b.x + 5},330 ${b.tx + 70},-20 ${b.tx - 70},-20`} fill={`url(#${uid}b)`} opacity={b.o} />
        ))}
        {shapes.lasers.map((l, i) => <line key={i} x1="400" y1="320" x2={l.x2} y2={l.y2} stroke={p.laser} strokeWidth="1.4" opacity="0.55" />)}
      </g>
      {/* stage + truss */}
      <path d="M190 360 L610 360 L640 400 L160 400 Z" fill="#05030a" />
      <rect x="190" y="318" width="420" height="8" fill="#0a0612" />
      <rect x="196" y="318" width="6" height="44" fill="#0a0612" /><rect x="598" y="318" width="6" height="44" fill="#0a0612" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <circle key={i} cx={230 + i * 57} cy="330" r="3" fill={p.beam} />)}
      {/* crowd */}
      <g fill="#030207">
        <path d={shapes.crowd} />
        {shapes.hands.map((h, i) => (
          <rect key={i} x={h.x - 2.5} y={h.y} width="5" height="34" rx="2.5" transform={`rotate(${h.a} ${h.x} ${h.y + 34})`} />
        ))}
      </g>
      <rect width="800" height="450" fill={`url(#${uid}f)`} />
    </svg>
  );
}

/**
 * Festival media: generated poster with an optional photo fading in on top.
 * photo: undefined → the festival's default photo; null/false → art only; string → that URL.
 */
export default function FestivalArt({ id = 1, name = '', photo, w = 1200, eager = false }) {
  const src = photo === undefined ? festivalPhoto(id, w) : photo || null;
  const [state, setState] = useState('loading');
  return (
    <div className="art">
      <Poster id={id} name={name} />
      {src && state !== 'error' && (
        <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" className={state === 'loaded' ? 'loaded' : ''}
          onLoad={() => setState('loaded')} onError={() => setState('error')} />
      )}
    </div>
  );
}
