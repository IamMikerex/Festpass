import { useId } from 'react';

// FestPass mark: an admit-one ticket (side notches) whose cut-out is an equalizer, i.e. "a pass to the music".
// Variants: ticket (filled), stage (round spotlight badge), outline (stroke only; also reads on light backgrounds).
const BARS = [[9, 13], [13.5, 8], [18, 11], [22.5, 15]]; // [x, top] — bars rise from y=24

export default function Logo({ variant = 'ticket', size = 34 }) {
  const id = useId().replace(/:/g, '');
  const filled = variant !== 'outline';
  const shape = variant === 'stage'
    ? <circle cx="16" cy="16" r="15" />
    : <path d="M6 3h20a3 3 0 0 1 3 3v6.5a3.5 3.5 0 0 0 0 7V26a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6.5a3.5 3.5 0 0 0 0-7V6a3 3 0 0 1 3-3z" />;
  return (
    <svg className={`logo-mark logo-${variant}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--a1)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--a2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--a3)' }} />
        </linearGradient>
      </defs>
      <g fill={filled ? `url(#${id})` : 'none'} stroke={filled ? 'none' : `url(#${id})`} strokeWidth="2">{shape}</g>
      {BARS.map(([x, top], i) => (
        <rect key={x} className="logo-bar" style={{ animationDelay: `${i * -0.45}s` }} x={x - 1.4} y={top} width="2.8" height={24 - top} rx="1.4"
          fill={filled ? '#0b0716' : `url(#${id})`} />
      ))}
      {variant === 'stage' && <path d="M24.5 6.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="#fff" opacity="0.9" />}
    </svg>
  );
}

export function Wordmark({ variant }) {
  return <span className="wordmark"><Logo variant={variant} /><span>Fest<b>Pass</b></span></span>;
}
