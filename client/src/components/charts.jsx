import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
import { date, moneyCompact, money } from '../lib/format';

export const COLORS = ['#6d28d9', '#ec4899', '#0ea5e9', '#f59e0b', '#10b981', '#64748b'];
const axis = { fontSize: 12, fill: '#9a96b0' };
const tip = { contentStyle: { borderRadius: 10, border: '1px solid #e6e3f0', fontSize: 13 } };

export function RevenueChart({ data }) {
  const rows = data.map((d) => ({ ...d, label: date(d.day, { day: 'numeric', month: 'short' }) }));
  return (
    <ResponsiveContainer>
      <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d28d9" stopOpacity={0.35} /><stop offset="1" stopColor="#6d28d9" stopOpacity={0} /></linearGradient>
          <linearGradient id="ref" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ec4899" stopOpacity={0.3} /><stop offset="1" stopColor="#ec4899" stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid stroke="#eeecf6" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={moneyCompact} width={70} />
        <Tooltip {...tip} formatter={(v, n) => [money(v), n]} />
        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#6d28d9" strokeWidth={2} fill="url(#rev)" />
        <Area type="monotone" dataKey="refunds" name="Refunds" stroke="#ec4899" strokeWidth={2} fill="url(#ref)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TicketsBarChart({ data, x = 'day', y = 'tickets', name = 'Tickets', fmtX }) {
  const rows = data.map((d) => ({ ...d, label: fmtX ? fmtX(d[x]) : d[x] }));
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke="#eeecf6" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip {...tip} />
        <Bar dataKey={y} name={name} fill="#6d28d9" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FlowChart({ data }) {
  const rows = data.map((d) => ({ ...d, entries: Number(d.entries), exits: Number(d.exits), rejected: Number(d.rejected), label: d.hour.slice(5).replace(' ', ' · ') }));
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke="#eeecf6" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="entries" name="Entries" stackId="a" fill="#10b981" />
        <Bar dataKey="exits" name="Exits" stackId="a" fill="#0ea5e9" />
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
