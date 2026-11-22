import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend, ComposedChart, Line } from 'recharts';
import { date, moneyCompact, money, num } from '../lib/format';

export const COLORS = ['#a855f7', '#f472b6', '#22d3ee', '#fb923c', '#34d399', '#8b85a1'];
const axis = { fontSize: 12, fill: '#8b85a1' };
const tip = {
  contentStyle: { borderRadius: 12, border: '1px solid rgba(255,255,255,0.16)', background: '#241f32', fontSize: 13, color: '#f5f3fb' },
  labelStyle: { color: '#f5f3fb', fontWeight: 700 },
  itemStyle: { color: '#f5f3fb' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
};

export function RevenueChart({ data }) {
  const rows = data.map((d) => ({ ...d, label: date(d.day, { day: 'numeric', month: 'short' }) }));
  return (
    <ResponsiveContainer>
      <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a855f7" stopOpacity={0.35} /><stop offset="1" stopColor="#a855f7" stopOpacity={0} /></linearGradient>
          <linearGradient id="ref" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f472b6" stopOpacity={0.3} /><stop offset="1" stopColor="#f472b6" stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={moneyCompact} width={70} />
        <Tooltip {...tip} formatter={(v, n) => [money(v), n]} />
        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#c084fc" strokeWidth={2} fill="url(#rev)" />
        <Area type="monotone" dataKey="refunds" name="Refunds" stroke="#f472b6" strokeWidth={2} fill="url(#ref)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TicketsBarChart({ data, x = 'day', y = 'tickets', name = 'Tickets', fmtX }) {
  const rows = data.map((d) => ({ ...d, label: fmtX ? fmtX(d[x]) : d[x] }));
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip {...tip} />
        <Bar dataKey={y} name={name} fill="#a855f7" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FlowChart({ data }) {
  const rows = data.map((d) => ({ ...d, entries: Number(d.entries), exits: Number(d.exits), rejected: Number(d.rejected), label: d.hour.slice(5).replace(' ', ' · ') }));
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="entries" name="Entries" stackId="a" fill="#34d399" />
        <Bar dataKey="exits" name="Exits" stackId="a" fill="#60a5fa" />
        <Bar dataKey="rejected" name="Rejected" stackId="a" fill="#f87171" radius={[6, 6, 0, 0]} />
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

/** Tickets sold per day (bars) and the running total (line, right axis). */
export function SalesChart({ data }) {
  const rows = data.map((d) => ({ ...d, label: date(d.day, { day: 'numeric', month: 'short' }) }));
  return (
    <ResponsiveContainer>
      <ComposedChart data={rows} margin={{ left: 0, right: 0, top: 8 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis yAxisId="day" tick={axis} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <YAxis yAxisId="total" orientation="right" tick={axis} tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={num} />
        <Tooltip {...tip} formatter={(v, n) => [num(v), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="day" dataKey="tickets" name="Sold that day" fill="#a855f7" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Line yAxisId="total" type="monotone" dataKey="cumulative_tickets" name="Total sold" stroke="#22d3ee" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Gate entries, exits and refusals per day. */
export function GateDailyChart({ data }) {
  const rows = data.map((d) => ({ ...d, label: date(d.day, { day: 'numeric', month: 'short' }) }));
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="entries" name="Entries" stackId="a" fill="#34d399" maxBarSize={36} />
        <Bar dataKey="exits" name="Exits" stackId="a" fill="#60a5fa" maxBarSize={36} />
        <Bar dataKey="rejected" name="Refused" stackId="a" fill="#f87171" radius={[6, 6, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
