import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { Alert, Badge, Confirm, Empty, ErrorState, Loading, useToast } from '../components/ui';
import PaymentForm from '../components/PaymentForm';
import Countdown from '../components/Countdown';
import { dateRange, money } from '../lib/format';

export default function Checkout() {
  const { orderId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => api.get(`/orders/${orderId}`), [orderId]);
  const [expired, setExpired] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const onExpire = useCallback(() => setExpired(true), []);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const o = data.order;
  const due = Number(o.total_amount) - Number(o.captured_amount);

  const pay = async (p) => {
    try {
      await api.post(`/orders/${orderId}/pay`, p);
      toast.success('Payment captured. Your tickets are ready!');
      nav('/tickets');
    } catch (e) {
      if (e.status === 410) { setExpired(true); reload(true); }
      throw e;
    }
  };

  if (o.status !== 'PENDING' || expired) {
    const ok = o.status === 'PAID';
    return (
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <Empty icon={ok ? CheckCircle2 : expired || o.status === 'EXPIRED' ? Clock : XCircle}
          title={ok ? 'This order is paid' : expired || o.status === 'EXPIRED' ? 'Your checkout hold expired' : `Order ${o.status.toLowerCase()}`}
          action={<div className="row" style={{ justifyContent: 'center' }}>
            {ok ? <Link className="btn btn-primary" to="/tickets">View my tickets</Link> : <Link className="btn btn-primary" to={`/festivals/${o.festival_id}`}>Choose tickets again</Link>}
            <Link className="btn btn-outline" to="/orders">My orders</Link>
          </div>}>
          {!ok && 'Holds last 10 minutes. The tickets were released back to other fans.'}
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Checkout</h1><p>Order #{o.order_id} · {o.festival_name}</p></div>
        <Countdown seconds={o.seconds_left} onDone={onExpire} />
      </div>
      <div className="detail-grid">
        <div className="card">
          <div className="card-head"><h2>Payment</h2><span className="muted small">Secure test gateway</span></div>
          <div className="card-body"><PaymentForm amount={due} onPay={pay} /></div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>{o.festival_name}</h3><Badge value={o.status} /></div>
            <div className="card-body">
              <p className="small muted mb-2">{o.venue_name}, {o.city} · {dateRange(o.start_date, o.end_date)}</p>
              {o.tickets.map((t) => (
                <div key={t.ticket_id} className="summary-line">
                  <span>{t.tier_name}<br /><span className="tiny muted">Holder: {t.holder_name}</span></span>
                  <span>{money(t.price)}</span>
                </div>
              ))}
              <div className="summary-total"><span>Total</span><span>{money(o.total_amount)}</span></div>
            </div>
          </div>
          <Alert kind="warning">Tickets are held until the timer runs out. After that they go back on sale.</Alert>
          <button className="btn btn-danger-outline" onClick={() => setCancelOpen(true)}>Cancel this order</button>
        </div>
      </div>
      {cancelOpen && (
        <Confirm title="Cancel this order?" danger confirmLabel="Cancel order" onClose={() => setCancelOpen(false)}
          onConfirm={async () => { await api.post(`/orders/${orderId}/cancel`); toast.success('Order cancelled'); nav('/orders'); }}>
          <p>The held tickets will be released immediately. Nothing has been charged.</p>
        </Confirm>
      )}
    </>
  );
}
