import { Link } from 'react-router-dom';
import { Ticket, Wallet, Undo2, ScanLine, Store, CalendarDays, Repeat, AlertCircle, ArrowRight } from 'lucide-react';
import { analytics } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { useAuth } from '../../lib/auth';
import { Badge, ErrorState, Loading, Progress, Stat } from '../../components/ui';
import { RevenueChart, Donut } from '../../components/charts';
import { dateRange, dateTime, label, money, moneyCompact, num, pct } from '../../lib/format';

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => analytics.get('/dashboard'), []);
  if (loading) return <Loading label="Crunching numbers…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const t = data.totals;
  return (
    <>
      <div className="page-head">
        <div><h1>{user.role === 'AUDITOR' ? 'Finance overview' : `Welcome back, ${user.full_name.split(' ')[0]}`}</h1>
          <p>{user.role === 'AUDITOR' ? 'Read-only view across every festival.' : `${t.festivals} festivals · ${t.live} live · ${t.on_sale} on sale`}</p></div>
        {user.role === 'ORGANIZER' && <Link to="/admin/festivals?new=1" className="btn btn-primary"><CalendarDays size={16} />New festival</Link>}
      </div>

      {user.role === 'ORGANIZER' && (t.pending_applications > 0 || t.pending_vendors > 0) && (
        <div className="card card-pad mb-2 row-between" style={{ borderColor: 'rgba(251,191,36,.35)', background: 'var(--warning-50)' }}>
          <div className="row"><AlertCircle size={18} color="var(--warning)" /><span><b>Needs your review:</b> {t.pending_applications} stall application(s) and {t.pending_vendors} new vendor(s).</span></div>
          <Link to="/admin/vendors" className="btn btn-outline btn-sm">Review <ArrowRight size={14} /></Link>
        </div>
      )}

      <div className="grid grid-4 mb-2">
        <Stat icon={Wallet} label="Net revenue" value={moneyCompact(t.net)} sub={`${money(t.gross)} gross`} />
        <Stat icon={Ticket} tone="pink" label="Tickets sold" value={num(t.tickets_sold)} sub={`${num(t.checked_in)} checked in`} />
        <Stat icon={Undo2} tone="amber" label="Refunds" value={moneyCompact(t.refunds)} sub={`${t.refund_count} refund payments`} />
        <Stat icon={Store} tone="green" label="Stall fees" value={moneyCompact(t.stall_revenue)} sub={`${t.transfers} ticket transfers`} />
      </div>

      <div className="grid grid-3 mb-2">
        <div className="card span-2">
          <div className="card-head"><h3>Revenue, last 30 days</h3><span className="small muted">captured charges vs refunds</span></div>
          <div className="card-body chart-box">{data.daily.length ? <RevenueChart data={data.daily} /> : <p className="muted small">No payments in the last 30 days.</p>}</div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Payment methods</h3></div>
          <div className="card-body chart-box">{data.methods.length ? <Donut data={data.methods.map((m) => ({ ...m, method: label(m.method) }))} nameKey="method" valueKey="amount" fmt={money} /> : <p className="muted small">No data</p>}</div>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card span-2">
          <div className="card-head"><h3>Festivals</h3><Link to="/admin/festivals" className="btn btn-ghost btn-sm">Manage <ArrowRight size={14} /></Link></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Festival</th><th>Status</th><th>Sold</th><th className="num">Revenue</th><th className="num">Checked in</th></tr></thead>
            <tbody>{data.festivals.map((f) => (
              <tr key={f.festival_id}>
                <td><Link to={`/admin/festivals/${f.festival_id}`} className="bold">{f.name}</Link><div className="tiny muted">{dateRange(f.start_date, f.end_date)}</div></td>
                <td><Badge value={f.status} /></td>
                <td style={{ minWidth: 150 }}><div className="tiny muted mb-1">{num(f.tickets_sold)} / {num(f.total_quota)} ({pct(f.tickets_sold, f.total_quota)}%)</div><Progress value={f.tickets_sold} max={f.total_quota} /></td>
                <td className="num">{money(f.ticket_revenue)}</td>
                <td className="num">{num(f.checked_in)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Latest orders</h3></div>
          <div className="card-body stack-sm">
            {data.recent_orders.map((o) => (
              <div key={o.order_id} className="row-between small">
                <div><b>{o.buyer_name}</b><div className="tiny muted">{o.ticket_count} × {o.festival_name} · {dateTime(o.created_at)}</div></div>
                <div className="right"><div className="bold">{money(o.total_amount)}</div><Badge value={o.status} /></div>
              </div>
            ))}
          </div>
          <div className="card-foot row"><ScanLine size={15} className="muted" /><span className="small muted">Charts and figures are computed live by the FastAPI analytics service.</span></div>
        </div>
      </div>
      <div className="mt-2 row small muted"><Repeat size={14} /> Figures include only captured payments; refunds are separate ledger rows (rule 13).</div>
    </>
  );
}
