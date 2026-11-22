import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ticket, Wallet, Undo2, ScanLine, Store, CalendarDays, Repeat, AlertCircle, ArrowRight, Users, Gauge, X, Filter } from 'lucide-react';
import { analytics, qs } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { useAuth } from '../../lib/auth';
import { Badge, ErrorState, Loading, Progress, Stat } from '../../components/ui';
import { RevenueChart, Donut, SalesChart, GateDailyChart } from '../../components/charts';
import { date, dateRange, dateTime, label, money, moneyCompact, num, pct } from '../../lib/format';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PRESETS = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']];
const RESULT_LABEL = { ACCEPTED: 'Accepted', REJECTED_DUPLICATE: 'Refused: already inside', REJECTED_INVALID: 'Refused: invalid ticket', REJECTED_NOT_LIVE: 'Refused: festival not running' };
const APP_TONE = { APPLIED: '', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'amber' };

/** One labelled bar per row: value out of max. */
function BarList({ rows }) {
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <div className="row-between"><span>{r.label}</span><b>{r.text ?? num(r.value)}</b></div>
          <Progress value={r.value} max={r.max || 1} tone={r.tone} />
        </div>
      ))}
    </div>
  );
}

function Filters({ data, params, setParams, busy }) {
  const festival = params.get('festival') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const today = iso(new Date());
  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const preset = PRESETS.find(([n]) => from === daysAgo(Number(n) - 1) && to === today)?.[0] || (!from && !to ? 'all' : '');
  return (
    <div className="card card-pad mb-2">
      <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <label className="stack-sm" style={{ flex: '1 1 220px', gap: 6 }}>
          <span className="small bold">Festival</span>
          <select className="select" style={{ width: '100%' }} value={festival} onChange={(e) => set({ festival: e.target.value })} aria-label="Festival">
            <option value="">All festivals</option>
            {data.filters.festivals.map((f) => <option key={f.festival_id} value={f.festival_id}>{f.name} ({label(f.status)})</option>)}
          </select>
        </label>
        <label className="stack-sm" style={{ flex: '1 1 150px', gap: 6 }}>
          <span className="small bold">From</span>
          <input className="input" type="date" value={from} max={to || today} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
        </label>
        <label className="stack-sm" style={{ flex: '1 1 150px', gap: 6 }}>
          <span className="small bold">To</span>
          <input className="input" type="date" value={to} min={from || undefined} max={today} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
        </label>
        <div className="segmented" role="group" aria-label="Date range">
          {PRESETS.map(([n, l]) => <button key={n} type="button" className={preset === n ? 'on' : ''} aria-pressed={preset === n} onClick={() => set({ from: daysAgo(Number(n) - 1), to: today })}>{l.replace('Last ', '')}</button>)}
          <button type="button" className={preset === 'all' ? 'on' : ''} aria-pressed={preset === 'all'} onClick={() => set({ from: '', to: '' })}>All time</button>
        </div>
        {(festival || from || to) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}><X size={14} />Clear</button>}
      </div>
      <p className="tiny muted mt-1 row" style={{ gap: 6 }}>
        <Filter size={13} />
        {busy ? 'Updating…' : <>
          Showing {festival ? <b>{data.filters.festivals.find((f) => String(f.festival_id) === festival)?.name}</b> : 'all your festivals'}{from || to ? `, ${from ? date(from) : 'the start'} to ${to ? date(to) : 'today'}` : ', all time'}.
          {' '}Capacity, remaining tickets and "inside now" are always current.
        </>}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = qs({ festival_id: params.get('festival') || '', from: params.get('from') || '', to: params.get('to') || '' });
  const { data, loading, error, reload } = useFetch(() => analytics.get(`/dashboard${query}`), [query]);
  const [scope, setScope] = useState('active');
  if (!data && loading) return <Loading label="Crunching numbers…" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const t = data.totals;
  const tk = data.tickets;
  const rv = data.revenue;
  const g = data.gate;
  const v = data.vendors;
  const ACTIVE = ['LIVE', 'ON_SALE', 'DRAFT'];
  const festRows = data.festivals.filter((f) => data.filters.festival_id || scope === 'all' || (scope === 'active' ? ACTIVE.includes(f.status) : !ACTIVE.includes(f.status)));
  const ticketTotal = tk.sold + tk.refunded + tk.void + tk.on_hold;
  const hasSales = data.sales.some((d) => d.tickets > 0);
  const hasMoney = data.sales.some((d) => d.revenue > 0 || d.refunds > 0);
  return (
    <>
      <div className="page-head">
        <div><span className="eyebrow">{user.role === 'AUDITOR' ? 'Auditor' : 'Organizer'} dashboard</span><h1 className="mt-1">{user.role === 'AUDITOR' ? 'Finance overview' : `Welcome back, ${user.full_name.split(' ')[0]}`}</h1>
          <p>{user.role === 'AUDITOR' ? 'Read-only view across every festival.' : `${data.filters.festivals.length} festivals · ${data.filters.festivals.filter((f) => f.status === 'LIVE').length} live · ${data.filters.festivals.filter((f) => f.status === 'ON_SALE').length} on sale`}</p></div>
        {user.role === 'ORGANIZER' && <Link to="/admin/festivals?new=1" className="btn btn-primary"><CalendarDays size={16} />New festival</Link>}
      </div>

      {user.role === 'ORGANIZER' && (t.pending_applications > 0 || t.pending_vendors > 0) && (
        <div className="card callout card-pad mb-2 row-between">
          <div className="row"><AlertCircle size={18} color="var(--warning)" /><span><b>Needs your review:</b> {t.pending_applications} stall application(s) and {t.pending_vendors} new vendor(s).</span></div>
          <Link to="/admin/vendors" className="btn btn-outline btn-sm">Review <ArrowRight size={14} /></Link>
        </div>
      )}

      <Filters data={data} params={params} setParams={setParams} busy={loading} />
      {error && <div className="mb-2"><ErrorState error={error} onRetry={reload} /></div>}

      <div className="grid grid-4 mb-2" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
        <Stat icon={Ticket} tone="pink" label="Tickets sold" value={num(tk.sold)} sub={`${money(tk.face_value)} face value`} />
        <Stat icon={Wallet} label="Total revenue" value={moneyCompact(rv.net)} sub={`${money(rv.gross)} charged − ${moneyCompact(rv.refunds)} refunded`} />
        <Stat icon={Gauge} tone="green" label="Tickets remaining" value={num(tk.remaining)} sub={`of ${num(tk.capacity)} ${data.filters.festival_id ? 'capacity' : 'capacity on sale'}`} />
        <Stat icon={Users} tone="amber" label="Attendance" value={`${pct(data.attendance.checked_in, data.attendance.sold)}%`} sub={`${num(data.attendance.checked_in)} checked in · ${num(data.attendance.inside_now)} inside now`} />
      </div>

      <div className="grid grid-3 mb-2">
        <div className="card span-2">
          <div className="card-head"><h3>Ticket sales over time</h3><span className="small muted">tickets sold per day and running total</span></div>
          <div className="card-body chart-box">{hasSales ? <SalesChart data={data.sales} /> : <p className="muted small">No tickets sold in this period.</p>}</div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Tickets by status</h3><span className="small muted">{num(ticketTotal)} issued</span></div>
          <div className="card-body">
            <BarList rows={[
              { label: 'Sold (valid or checked in)', value: tk.sold, max: ticketTotal },
              { label: 'Checked in', value: tk.checked_in, max: ticketTotal, tone: 'green' },
              { label: 'Refunded', value: tk.refunded, max: ticketTotal, tone: 'amber' },
              { label: 'Void (expired or cancelled checkout)', value: tk.void, max: ticketTotal, tone: 'red' },
              { label: 'On hold in checkout', value: tk.on_hold, max: ticketTotal },
            ]} />
            <p className="tiny muted mt-2">{num(t.transfers)} ticket transfer(s) in this period.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-3 mb-2">
        <div className="card span-2">
          <div className="card-head"><h3>Ticket revenue over time</h3><span className="small muted">captured charges vs refunds</span></div>
          <div className="card-body chart-box">{hasMoney ? <RevenueChart data={data.sales} /> : <p className="muted small">No ticket payments in this period.</p>}</div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Payment methods</h3><span className="small muted">ticket charges</span></div>
          <div className="card-body chart-box">{data.methods.length ? <Donut data={data.methods.map((m) => ({ ...m, method: label(m.method) }))} nameKey="method" valueKey="amount" fmt={money} /> : <p className="muted small">No data</p>}</div>
        </div>
      </div>

      <div className="grid grid-3 mb-2">
        <div className="card">
          <div className="card-head"><h3>Payments &amp; refunds</h3><Undo2 size={16} className="muted" /></div>
          <div className="card-body stack-sm small">
            <div className="row-between"><span>Ticket sales charged</span><b>{money(rv.ticket_charges)}</b></div>
            <div className="row-between"><span>Ticket refunds</span><b>− {money(rv.ticket_refunds)}</b></div>
            <div className="row-between"><span>Stall fees charged</span><b>{money(rv.stall_charges)}</b></div>
            <div className="row-between"><span>Stall fee refunds</span><b>− {money(rv.stall_refunds)}</b></div>
            <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}><span className="bold">Net revenue</span><b>{money(rv.net)}</b></div>
            <div className="row-between muted"><span>{num(rv.refund_count)} refund payment(s)</span><span>{num(rv.failed_count)} failed ({money(rv.failed_amount)})</span></div>
          </div>
          <div className="card-body stack-sm small" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="tiny muted bold">LEDGER ROWS</span>
            {data.payments.length === 0 && <p className="muted">No payments in this period.</p>}
            {data.payments.map((p) => (
              <div key={`${p.context}-${p.payment_type}-${p.status}`} className="row-between">
                <span>{p.context === 'STALL_FEE' ? 'Stall fee' : 'Ticket'} {label(p.payment_type).toLowerCase()} <Badge value={p.status} /></span>
                <span><span className="muted">{num(p.n)} ×</span> <b>{money(p.amount)}</b></span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Vendor applications</h3><span className="small muted">{num(v.total_applications)} in this period</span></div>
          <div className="card-body">
            <BarList rows={['APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({ label: s === 'APPLIED' ? 'Waiting for review' : label(s), value: v.applications[s], max: v.total_applications, tone: APP_TONE[s] }))} />
            <div className="stack-sm small mt-2">
              <div className="row-between"><span>Stall fees agreed (approved)</span><b>{money(v.fees.contracted)}</b></div>
              <div className="row-between"><span>Paid</span><b>{money(v.fees.paid)}</b></div>
              <div className="row-between"><span>Still due</span><b>{money(v.fees.outstanding)}</b></div>
              <div className="row-between"><span>Stalls allocated</span><b>{num(v.stalls.allocated)} / {num(v.stalls.stalls)}</b></div>
            </div>
          </div>
          <div className="card-foot row small muted"><Store size={15} />Vendor registry: {Object.entries(v.registry).map(([s, n]) => `${n} ${label(s).toLowerCase()}`).join(' · ') || 'empty'}</div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Gate entries</h3><ScanLine size={16} className="muted" /></div>
          <div className="card-body">
            <div className="mb-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <div><div className="tiny muted">Entries</div><div className="bold" style={{ fontSize: 22 }}>{num(g.entries)}</div></div>
              <div><div className="tiny muted">Exits</div><div className="bold" style={{ fontSize: 22 }}>{num(g.exits)}</div></div>
              <div><div className="tiny muted">Refused</div><div className="bold" style={{ fontSize: 22 }}>{num(g.rejected)}</div></div>
            </div>
            <BarList rows={g.by_result.map((r) => ({ label: RESULT_LABEL[r.result] || label(r.result), value: r.n, max: g.scans, tone: r.result === 'ACCEPTED' ? 'green' : 'red' }))} />
            <p className="tiny muted mt-2">{num(g.unique_visitors)} different tickets entered · {num(g.scans)} scans in total</p>
          </div>
        </div>
      </div>

      {g.daily.length > 0 && (
        <div className="grid grid-3 mb-2">
          <div className="card span-2">
            <div className="card-head"><h3>Gate activity per day</h3></div>
            <div className="card-body chart-box sm"><GateDailyChart data={g.daily} /></div>
          </div>
          <div className="card">
            <div className="card-head"><h3>By gate</h3></div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Gate</th><th className="num">In</th><th className="num">Out</th><th className="num">Refused</th></tr></thead>
              <tbody>{g.by_gate.map((x) => <tr key={x.gate_code}><td className="mono">{x.gate_code}</td><td className="num">{num(x.entries)}</td><td className="num">{num(x.exits)}</td><td className="num">{num(x.rejected)}</td></tr>)}</tbody>
            </table></div>
          </div>
        </div>
      )}

      <div className="grid grid-3">
        <div className="card span-2">
          <div className="card-head"><h3>Festival attendance</h3>
            <div className="row">
              {!data.filters.festival_id && (
                <div className="segmented" role="group" aria-label="Filter festivals">
                  {[['active', 'Active'], ['past', 'Past & cancelled'], ['all', 'All']].map(([k, l]) => <button key={k} className={scope === k ? 'on' : ''} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}
                </div>
              )}
              <Link to="/admin/festivals" className="btn btn-ghost btn-sm">Manage <ArrowRight size={14} /></Link>
            </div>
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Festival</th><th>Status</th><th>Sold</th><th className="num">Remaining</th><th className="num">Checked in</th><th className="num">Revenue</th></tr></thead>
            <tbody>{festRows.length === 0 && <tr><td colSpan={6} className="muted small center">No festivals in this view.</td></tr>}{festRows.map((f) => (
              <tr key={f.festival_id}>
                <td><Link to={`/admin/festivals/${f.festival_id}`} className="bold">{f.name}</Link><div className="tiny muted">{dateRange(f.start_date, f.end_date)}</div></td>
                <td><Badge value={f.status} /></td>
                <td style={{ minWidth: 140 }}><div className="tiny muted mb-1">{num(f.tickets_sold)} / {num(f.total_quota)} ({pct(f.tickets_sold, f.total_quota)}%)</div><Progress value={f.tickets_sold} max={f.total_quota} /></td>
                <td className="num">{['COMPLETED', 'CANCELLED'].includes(f.status) ? '—' : num(f.remaining)}</td>
                <td className="num">{num(f.checked_in)} <span className="tiny muted">({pct(f.checked_in, f.tickets_sold)}%)</span>{f.status === 'LIVE' && <div className="tiny muted">{num(f.inside_now)} inside now</div>}</td>
                <td className="num">{money(f.ticket_revenue)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="card-foot small muted">Current totals for each festival; the date filter does not apply to this table.</div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Latest orders</h3></div>
          <div className="card-body stack-sm">
            {data.recent_orders.length === 0 && <p className="small muted">No orders in this period.</p>}
            {data.recent_orders.map((o) => (
              <div key={o.order_id} className="row-between small">
                <div><b>{o.buyer_name}</b><div className="tiny muted">{o.ticket_count} × {o.festival_name} · {dateTime(o.created_at)}</div></div>
                <div className="right"><div className="bold">{money(o.total_amount)}</div><Badge value={o.status} /></div>
              </div>
            ))}
          </div>
          <div className="card-foot row"><ScanLine size={15} className="muted" /><span className="small muted">Every figure on this page is computed live from the database by the FastAPI analytics service.</span></div>
        </div>
      </div>
      <div className="mt-2 row small muted"><Repeat size={14} /> Revenue counts only captured payments; refunds are separate ledger rows (rule 13).</div>
    </>
  );
}
