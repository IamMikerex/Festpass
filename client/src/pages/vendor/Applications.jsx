import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, CreditCard, XCircle, Clock } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import PaymentForm from '../../components/PaymentForm';
import { Badge, Confirm, Empty, ErrorState, Loading, Modal, useToast } from '../../components/ui';
import { dateRange, dateTime, label, money } from '../../lib/format';

const hoursLeft = (s) => Math.max(0, Math.floor(s / 3600));

export default function Applications() {
  const { data, loading, error, reload } = useFetch(() => api.get('/allocations/mine'), []);
  const [payFor, setPayFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const cancelText = (a) => {
    const paid = Number(a.paid_amount) - Number(a.refunded_amount);
    if (a.status === 'APPLIED') return 'Your application will be withdrawn.';
    if (paid <= 0) return 'The fee is unpaid, so nothing is refunded. The stall becomes available to other vendors.';
    return a.days_before_start < 21
      ? `The festival starts in ${a.days_before_start} days (less than 21), so 50% of the paid fee is forfeited: you get ${money(paid * 0.5)} back.`
      : `You cancel more than 21 days before the festival, so the full ${money(paid)} is refunded.`;
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Stall applications</h1><p>Track approvals, pay fees before the 7-day deadline, or cancel.</p></div>
        <Link to="/vendor/stalls" className="btn btn-primary">New application</Link>
      </div>
      <div className="card">
        {data.allocations.length === 0 ? <Empty icon={ClipboardList} title="No applications yet" action={<Link to="/vendor/stalls" className="btn btn-primary">Find a stall</Link>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Stall</th><th>Festival</th><th>Business</th><th className="num">Fee</th><th>Status</th><th>Payment</th><th /></tr></thead>
            <tbody>{data.allocations.map((a) => {
              const outstanding = a.status === 'APPROVED' && Number(a.paid_amount) < Number(a.agreed_fee);
              return (
                <tr key={a.allocation_id}>
                  <td><b className="mono">{a.stall_code}</b><div className="tiny muted">{label(a.zone)} · {Number(a.size_m2)} m²</div></td>
                  <td>{a.festival_name}<div className="tiny muted">{dateRange(a.start_date, a.end_date)}</div></td>
                  <td>{a.legal_name}</td>
                  <td className="num">{money(a.agreed_fee)}</td>
                  <td><Badge value={a.status} /><div className="tiny muted mt-1">applied {dateTime(a.applied_at)}</div></td>
                  <td>
                    {a.status === 'APPROVED' && (outstanding
                      ? <span className="badge amber plain"><Clock size={12} />Due in {hoursLeft(a.fee_seconds_left)}h</span>
                      : <Badge tone="green">Paid {money(a.paid_amount)}</Badge>)}
                    {Number(a.refunded_amount) > 0 && <div className="tiny muted mt-1">Refunded {money(a.refunded_amount)}</div>}
                  </td>
                  <td className="right nowrap">
                    {outstanding && a.fee_seconds_left > 0 && <button className="btn btn-primary btn-sm" onClick={() => setPayFor(a)}><CreditCard size={14} />Pay fee</button>}
                    {['APPLIED', 'APPROVED'].includes(a.status) && <button className="btn btn-ghost btn-sm" onClick={() => setCancelFor(a)}><XCircle size={14} />Cancel</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      {payFor && (
        <Modal title={`Pay stall fee · ${payFor.stall_code}`} onClose={() => setPayFor(null)}>
          <p className="small muted mb-2">{payFor.festival_name} · {payFor.legal_name}. Deadline {dateTime(payFor.fee_due_at)}.</p>
          <PaymentForm amount={Number(payFor.agreed_fee) - Number(payFor.paid_amount)} cta="Pay"
            onPay={async (p) => { await api.post(`/allocations/${payFor.allocation_id}/pay`, p); toast.success('Stall fee paid'); setPayFor(null); reload(true); }} />
        </Modal>
      )}
      {cancelFor && (
        <Confirm title={`Cancel ${cancelFor.stall_code}?`} danger confirmLabel="Cancel allocation" onClose={() => setCancelFor(null)}
          onConfirm={async () => { const r = await api.post(`/allocations/${cancelFor.allocation_id}/cancel`); toast.success(r.refund ? `Cancelled · ${money(r.refund)} refunded` : 'Cancelled'); reload(true); }}>
          <p>{cancelText(cancelFor)}</p>
        </Confirm>
      )}
    </>
  );
}
