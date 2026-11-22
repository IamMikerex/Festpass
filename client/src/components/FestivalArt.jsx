// Generated, deterministic artwork per festival (the schema stores no images).
const PALETTES = [
  ['#6d28d9', '#ec4899', '#f59e0b'],
  ['#0ea5e9', '#6366f1', '#a855f7'],
  ['#f43f5e', '#f97316', '#facc15'],
  ['#059669', '#0ea5e9', '#6366f1'],
  ['#7c3aed', '#2563eb', '#06b6d4'],
  ['#db2777', '#9333ea', '#4f46e5'],
];

export default function FestivalArt({ id = 1, name = '' }) {
  const seed = Number(id) * 9301 + name.length * 49297;
  const rand = (n) => { const x = Math.sin(seed + n) * 10000; return x - Math.floor(x); };
  const [a, b, c] = PALETTES[Number(id) % PALETTES.length];
  const gid = `g${id}`;
  const bars = Array.from({ length: 28 }, (_, i) => 18 + rand(i) * 62);
  return (
    <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} /><stop offset="0.6" stopColor={b} /><stop offset="1" stopColor={c} />
        </linearGradient>
        <radialGradient id={`${gid}r`} cx="0.8" cy="0.1" r="0.7">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="200" fill={`url(#${gid})`} />
      <rect width="400" height="200" fill={`url(#${gid}r)`} />
      <circle cx={60 + rand(40) * 280} cy={40 + rand(41) * 60} r={36 + rand(42) * 30} fill="#fff" opacity="0.14" />
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M0 ${120 + i * 18} Q 100 ${80 + rand(i + 50) * 60 + i * 10} 200 ${120 + i * 14} T 400 ${110 + i * 16}`}
          stroke="#fff" strokeOpacity={0.22 - i * 0.05} strokeWidth="2" fill="none" />
      ))}
      <g opacity="0.35">
        {bars.map((h, i) => <rect key={i} x={i * 14.5 + 2} y={200 - h} width="8" height={h} rx="4" fill="#fff" />)}
      </g>
    </svg>
  );
}
