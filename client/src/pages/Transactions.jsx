import { Wallet, ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { Badge, Empty, ErrorState, Loading, Stat } from '../components/ui';
import { dateTime, label, money } from '../lib/format';

export default function Transactions() {
  const { data, loading, error, reload } = useFetch(() => api.get('/payments/mine'), []);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <div className="page-head"><div><h1>Payments</h1><p>Your full transaction history: charges and refunds, each kept as its own record.</p></div></div>
      <div className="grid grid-3 mb-2">
        <Stat icon={ArrowUpRight} label="Paid" value={money(data.totals.charged)} />
        <Stat icon={ArrowDownLeft} tone="green" label="Refunded" value={money(data.totals.refunded)} />
        <Stat icon={Scale} tone="blue" label="Net spent" value={money(data.totals.net)} />
      </div>
      <div className="card">
        {data.payments.length === 0 ? <Empty icon={Wallet} title="No payments yet" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Method</th><th>Status</th><th>Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>{data.payments.map((p) => (
              <tr key={p.payment_id}>
                <td className="nowrap">{dateTime(p.processed_at)}</td>
                <td>{p.description}<div className="tiny muted">{label(p.context)}</div></td>
                <td><Badge value={p.payment_type} /></td>
                <td>{label(p.method)}</td>
                <td><Badge value={p.status} /></td>
                <td className="mono tiny">{p.provider_ref}</td>
                <td className="num bold" style={{ color: p.payment_type === 'REFUND' ? 'var(--success)' : undefined }}>{p.payment_type === 'REFUND' ? '+' : '−'}{money(p.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
