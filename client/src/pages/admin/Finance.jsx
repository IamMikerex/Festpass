import { useState } from 'react';
import { Download, Receipt, ShieldCheck, ArrowUpRight, ArrowDownLeft, Store, AlertTriangle } from 'lucide-react';
import { analytics, api, qs } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { Alert, Badge, Empty, ErrorState, Loading, Stat, Tabs, useToast } from '../../components/ui';
import { dateTime, label, money } from '../../lib/format';

function Ledger({ festivals }) {
  const [f, setF] = useState({ festival_id: '', type: '', status: '', context: '', from: '', to: '' });
  const { data, loading, error } = useFetch(() => analytics.get(`/payments${qs(f)}`), [JSON.stringify(f)]);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const rows = data?.payments || [];
  const sum = (t) => rows.filter((p) => p.payment_type === t && p.status === 'CAPTURED').reduce((s, p) => s + Number(p.amount), 0);
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row">
          <select className="select" style={{ width: 'auto', minWidth: 220 }} value={f.festival_id} onChange={set('festival_id')}><option value="">All festivals</option>{festivals.map((x) => <option key={x.festival_id} value={x.festival_id}>{x.name}</option>)}</select>
          <select className="select" style={{ width: 'auto', minWidth: 140 }} value={f.type} onChange={set('type')}><option value="">Charges & refunds</option><option value="CHARGE">Charges</option><option value="REFUND">Refunds</option></select>
          <select className="select" style={{ width: 'auto', minWidth: 150 }} value={f.status} onChange={set('status')}><option value="">Any status</option>{['CAPTURED', 'AUTHORIZED', 'FAILED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <select className="select" style={{ width: 'auto', minWidth: 160 }} value={f.context} onChange={set('context')}><option value="">Tickets & stalls</option><option value="TICKET_ORDER">Ticket orders</option><option value="STALL_FEE">Stall fees</option></select>
          <input className="input" type="date" style={{ width: 160 }} value={f.from} onChange={set('from')} title="From" />
          <input className="input" type="date" style={{ width: 160 }} value={f.to} onChange={set('to')} title="To" />
          <button className="btn btn-outline" onClick={() => analytics.download(`/payments${qs(f)}`, 'payments.csv').catch((e) => toast.error(e.message))}><Download size={15} />CSV</button>
        </div>
      </div>
      <div className="grid grid-3">
        <Stat icon={ArrowUpRight} label="Captured charges (filtered)" value={money(sum('CHARGE'))} />
        <Stat icon={ArrowDownLeft} tone="pink" label="Refunds (filtered)" value={money(sum('REFUND'))} />
        <Stat icon={Receipt} tone="blue" label="Rows" value={rows.length} sub={rows.length >= 1000 ? 'showing first 1,000' : undefined} />
      </div>
      <div className="card">
        {loading ? <Loading /> : error ? <ErrorState error={error} /> : rows.length === 0 ? <Empty icon={Receipt} title="No payments match" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>#</th><th>Date</th><th>For</th><th>Counterparty</th><th>Type</th><th>Status</th><th>Method</th><th>Provider ref</th><th className="num">Amount</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.payment_id}>
                <td className="tiny muted">{p.payment_id}</td>
                <td className="nowrap small">{dateTime(p.processed_at)}</td>
                <td className="small">{p.festival_name}<div className="tiny muted">{p.order_id ? `Order #${p.order_id}` : `Stall allocation #${p.allocation_id}`}</div></td>
                <td className="small">{p.counterparty}</td>
                <td><Badge value={p.payment_type} /></td>
                <td><Badge value={p.status} /></td>
                <td className="small">{label(p.method)}</td>
                <td className="mono tiny">{p.provider_ref}</td>
                <td className="num bold">{p.payment_type === 'REFUND' ? '−' : ''}{money(p.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function Reconciliation() {
  const [all, setAll] = useState(false);
  const { data, loading, error } = useFetch(() => analytics.get(`/reconciliation${all ? '?show=all' : ''}`), [all]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const s = data.summary;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat icon={ArrowUpRight} label="Ticket charges captured" value={money(s.captured)} sub={`${s.orders} orders`} />
        <Stat icon={ArrowDownLeft} tone="pink" label="Ticket refunds" value={money(s.refunded)} sub={s.refunded <= s.captured ? 'within captured total' : 'exceeds captured!'} />
        <Stat icon={Store} tone="green" label="Stall fees captured" value={money(s.fees_captured)} sub={`${money(s.fees_refunded)} refunded`} />
        <Stat icon={AlertTriangle} tone="amber" label="Stall fees outstanding" value={s.fees_outstanding} sub="approved, not yet paid" />
      </div>
      {data.issues.filter((i) => i.verdict !== 'OK').length === 0
        ? <Alert kind="success"><b>Ledger reconciles.</b> Every paid order is fully covered by captured charges and no order has been refunded more than it was charged (rule 13).</Alert>
        : <Alert kind="warning">{data.issues.filter((i) => i.verdict !== 'OK').length} order(s) need attention.</Alert>}
      <div className="card">
        <div className="card-head"><h3>Orders vs. payments</h3><label className="checkbox small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show all orders</label></div>
        {data.issues.length === 0 ? <Empty icon={ShieldCheck} title="No discrepancies" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Order</th><th>Festival</th><th>Status</th><th className="num">Tickets</th><th className="num">Ticket value</th><th className="num">Captured</th><th className="num">Refunded</th><th>Verdict</th></tr></thead>
            <tbody>{data.issues.map((o) => (
              <tr key={o.order_id}><td>#{o.order_id}</td><td className="small">{o.festival_name}</td><td><Badge value={o.status} /></td><td className="num">{o.ticket_count}</td><td className="num">{money(o.total_amount)}</td><td className="num">{money(o.captured_amount)}</td><td className="num">{money(o.refunded_amount)}</td><td><Badge tone={o.verdict === 'OK' ? 'green' : 'red'}>{label(o.verdict)}</Badge></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function Finance() {
  const [tab, setTab] = useState('ledger');
  const fests = useFetch(() => api.get('/festivals/mine'), []);
  return (
    <>
      <div className="page-head"><div><h1>Payments & refunds</h1><p>One ledger for ticket orders and stall fees. Refunds are separate rows, so history is never overwritten.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'ledger', label: 'Ledger', icon: Receipt }, { id: 'recon', label: 'Reconciliation', icon: ShieldCheck }]} />
      {tab === 'ledger' && (fests.loading ? <Loading /> : <Ledger festivals={fests.data?.festivals || []} />)}
      {tab === 'recon' && <Reconciliation />}
    </>
  );
}
