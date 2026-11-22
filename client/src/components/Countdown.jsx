import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';

export default function Countdown({ seconds, onDone }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => {
    if (left <= 0) { onDone?.(); return undefined; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onDone]);
  const m = Math.floor(Math.max(left, 0) / 60);
  const s = Math.max(left, 0) % 60;
  return <span className={`countdown ${left < 120 ? 'low' : ''}`}><Timer size={16} />{m}:{String(s).padStart(2, '0')} left</span>;
}
