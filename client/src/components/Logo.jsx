import { useId } from 'react';

// The official FestPass mark: an admit-one ticket whose cut-out is an equalizer, with a stage-light spark.
// Brand colours are fixed on purpose: themes, lighting, motion and accessibility settings never change the logo.
// public/favicon.svg is the same drawing; keep them in sync.
export const BRAND = ['#ff8a1f', '#f43f5e', '#a855f7'];
const BARS = [[9, 14], [13.5, 9], [18, 12], [22.5, 16]]; // [x, top]: bars rise from y=24
const TICKET = 'M6 3h20a3 3 0 0 1 3 3v6.5a3.5 3.5 0 0 0 0 7V26a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6.5a3.5 3.5 0 0 0 0-7V6a3 3 0 0 1 3-3z';

export default function Logo({ size = 34, title }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND[0]} />
          <stop offset="0.55" stopColor={BRAND[1]} />
          <stop offset="1" stopColor={BRAND[2]} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={TICKET} fill={`url(#${id}g)`} />
      <path d={TICKET} fill={`url(#${id}s)`} />
      {BARS.map(([x, top]) => <rect key={x} x={x - 1.4} y={top} width="2.8" height={24 - top} rx="1.4" fill="#120a1f" />)}
      <path d="M24.6 5.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ size }) {
  return <span className="wordmark"><Logo size={size} /><span>Fest<b>Pass</b></span></span>;
}
