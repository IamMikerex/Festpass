import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { Badge, Empty, ErrorState, Loading } from '../components/ui';
import { dateTime, money } from '../lib/format';

function OrderRow({ o }) {
  const [open, setOpen] = useState(false);
  const { data } = useFetch(() => (open ? api.get(`/orders/${o.order_id}`) : Promise.resolve(null)), [open]);
  return (
    <>
      <tr>
        <td><b>#{o.order_id}</b><div className="tiny muted">{dateTime(o.created_at)}</div></td>
        <td>{o.festival_name}<div className="tiny muted">{o.city}</div></td>
        <td className="num">{o.ticket_count}</td>
        <td className="num">{money(o.total_amount)}</td>
        <td className="num">{Number(o.refunded_amount) > 0 ? <span className="muted">−{money(o.refunded_amount)}</span> : '—'}</td>
        <td><Badge value={o.status} /></td>
        <td className="right nowrap">
          {o.status === 'PENDING' && o.seconds_left > 0 && <Link className="btn btn-primary btn-sm" to={`/checkout/${o.order_id}`}>Pay now</Link>}
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen((x) => !x)}>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}Details</button>
        </td>
      </tr>
      {open && (
        <tr><td colSpan={7} style={{ background: '#fbfaff' }}>
          {!data ? <span className="muted small">Loading…</span> : (
            <div className="grid grid-2">
              <div>
                <p className="small bold mb-1">Tickets</p>
                {data.order.tickets.map((t) => (
                  <div key={t.ticket_id} className="summary-line small"><span>{t.tier_name} · {t.holder_name}</span><span><Badge value={t.status} /></span></div>
                ))}
              </div>
              <div>
                <p className="small bold mb-1">Payments</p>
                {data.order.payments.length === 0 && <p className="small muted">No payments</p>}
                {data.order.payments.map((p) => (
                  <div key={p.payment_id} className="summary-line small">
                    <span><Badge value={p.payment_type} /> <Badge value={p.status} /> <span className="mono tiny">{p.provider_ref}</span></span>
                    <span>{p.payment_type === 'REFUND' ? '−' : ''}{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </td></tr>
      )}
    </>
  );
}

export default function Orders() {
  const { data, loading, error, reload } = useFetch(() => api.get('/orders'), []);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <div className="page-head"><div><h1>Orders</h1><p>Every checkout you started, including tickets bought for friends.</p></div></div>
      <div className="card">
        {data.orders.length === 0 ? <Empty icon={ClipboardList} title="No orders yet" action={<Link to="/festivals" className="btn btn-primary">Browse festivals</Link>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Order</th><th>Festival</th><th className="num">Tickets</th><th className="num">Total</th><th className="num">Refunded</th><th>Status</th><th /></tr></thead>
            <tbody>{data.orders.map((o) => <OrderRow key={o.order_id} o={o} />)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
