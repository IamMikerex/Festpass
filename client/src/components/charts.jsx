import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
import { date, moneyCompact, money } from '../lib/format';

export const COLORS = ['#a78bfa', '#f0469c', '#38bdf8', '#fb923c', '#34d399', '#8a82ab'];
const axis = { fontSize: 12, fill: '#8a82ab' };
const tip = { contentStyle: { borderRadius: 12, border: '1px solid rgba(196,181,253,.26)', background: 'rgba(22,16,40,.95)', color: '#f4f1ff', fontSize: 13 }, labelStyle: { color: '#f4f1ff' }, cursor: { fill: 'rgba(139,92,246,.08)' } };

export function RevenueChart({ data }) {
  const rows = data.map((d) => ({ ...d, label: date(d.day, { day: 'numeric', month: 'short' }) }));
  return (
    <ResponsiveContainer>
      <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a78bfa" stopOpacity={0.35} /><stop offset="1" stopColor="#a78bfa" stopOpacity={0} /></linearGradient>
          <linearGradient id="ref" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f0469c" stopOpacity={0.3} /><stop offset="1" stopColor="#f0469c" stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={moneyCompact} width={70} />
        <Tooltip {...tip} formatter={(v, n) => [money(v), n]} />
        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#a78bfa" strokeWidth={2} fill="url(#rev)" />
        <Area type="monotone" dataKey="refunds" name="Refunds" stroke="#f0469c" strokeWidth={2} fill="url(#ref)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TicketsBarChart({ data, x = 'day', y = 'tickets', name = 'Tickets', fmtX }) {
  const rows = data.map((d) => ({ ...d, label: fmtX ? fmtX(d[x]) : d[x] }));
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip {...tip} />
        <Bar dataKey={y} name={name} fill="#a78bfa" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FlowChart({ data }) {
  const rows = data.map((d) => ({ ...d, entries: Number(d.entries), exits: Number(d.exits), rejected: Number(d.rejected), label: d.hour.slice(5).replace(' ', ' · ') }));
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="entries" name="Entries" stackId="a" fill="#34d399" />
        <Bar dataKey="exits" name="Exits" stackId="a" fill="#38bdf8" />
        <Bar dataKey="rejected" name="Rejected" stackId="a" fill="#ef4444" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, nameKey, valueKey, fmt = (v) => v }) {
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie data={data.map((d) => ({ ...d, [valueKey]: Number(d[valueKey]) }))} dataKey={valueKey} nameKey={nameKey} innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="none">
          {data.map((d, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip {...tip} formatter={(v, n) => [fmt(v), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
