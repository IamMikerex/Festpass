import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, Layers, MapPinned, Users, ScanLine, Pencil, Plus, Trash2, Download, Search,
  Ticket, Wallet, DoorOpen, Undo2, Play, Flag, Ban, ShoppingCart, Check, X, FileSearch,
} from 'lucide-react';
import { api, analytics, qs } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { useAuth } from '../../lib/auth';
import { Alert, Badge, Confirm, Empty, ErrorState, Field, Loading, Modal, Progress, Stat, Tabs, useToast } from '../../components/ui';
import { FlowChart, TicketsBarChart, Donut } from '../../components/charts';
import StallMap from '../../components/StallMap';
import FestivalForm from './FestivalForm';
import { date, dateRange, dateTime, label, money, num, pct } from '../../lib/format';

const STATUS_ACTIONS = {
  ON_SALE: { label: 'Open ticket sales', icon: Play, cls: 'btn-primary' },
  LIVE: { label: 'Mark as live', icon: DoorOpen, cls: 'btn-primary' },
  COMPLETED: { label: 'Complete festival', icon: Flag, cls: 'btn-outline' },
  CANCELLED: { label: 'Cancel festival', icon: Ban, cls: 'btn-danger-outline' },
};

// ------------------------------------------------------------------ overview
function Overview({ festivalId }) {
  const { data, loading, error, reload } = useFetch(() => analytics.get(`/festivals/${festivalId}/report`), [festivalId]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const s = data.stats;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat icon={Ticket} label="Tickets sold" value={num(s.tickets_sold)} sub={`${pct(s.tickets_sold, s.total_quota)}% of ${num(s.total_quota)}`} />
        <Stat icon={Wallet} tone="green" label="Net ticket revenue" value={money(s.ticket_revenue)} sub={`${money(data.refunds.amount)} refunded`} />
        <Stat icon={DoorOpen} tone="blue" label="Inside right now" value={num(data.inside_now)} sub={`${num(s.checked_in)} checked in total`} />
        <Stat icon={ShoppingCart} tone="amber" label="Orders" value={num(data.orders.paid)} sub={`${data.orders.pending} pending · ${data.orders.expired} expired`} />
      </div>
      <div className="grid grid-3">
        <div className="card span-2">
          <div className="card-head"><h3>Tickets sold per day</h3></div>
          <div className="card-body chart-box sm">{data.daily.length ? <TicketsBarChart data={data.daily} fmtX={(d) => date(d, { day: 'numeric', month: 'short' })} /> : <p className="small muted">No sales yet.</p>}</div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Revenue by tier</h3></div>
          <div className="card-body chart-box sm">{data.tiers.some((t) => t.revenue > 0) ? <Donut data={data.tiers} nameKey="tier_name" valueKey="revenue" fmt={money} /> : <p className="small muted">No revenue yet.</p>}</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Tier availability</h3><span className="small muted">remaining quota is computed live, never stored</span></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tier</th><th className="num">Price</th><th>Sold</th><th className="num">Remaining</th><th className="num">Revenue</th></tr></thead>
          <tbody>{data.tiers.map((t) => (
            <tr key={t.tier_id}>
              <td className="bold">{t.tier_name}</td><td className="num">{money(t.price)}</td>
              <td style={{ minWidth: 180 }}><div className="tiny muted mb-1">{num(t.sold)} / {num(t.quota)}</div><Progress value={t.sold} max={t.quota} /></td>
              <td className="num">{num(t.remaining)}</td><td className="num">{money(t.revenue)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      {data.hourly.length > 0 && (
        <div className="grid grid-3">
          <div className="card span-2">
            <div className="card-head"><h3>Gate flow per hour</h3></div>
            <div className="card-body chart-box sm"><FlowChart data={data.hourly.slice(-24)} /></div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Gates</h3></div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Gate</th><th className="num">In</th><th className="num">Out</th><th className="num">Refused</th></tr></thead>
              <tbody>{data.gates.map((g) => <tr key={g.gate_code}><td className="mono">{g.gate_code}</td><td className="num">{num(g.entries)}</td><td className="num">{num(g.exits)}</td><td className="num">{num(g.rejected)}</td></tr>)}</tbody>
            </table></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- tiers
function TierForm({ festivalId, tier, onClose, onSaved }) {
  const toLocal = (s) => (s ? s.replace(' ', 'T').slice(0, 16) : '');
  const [f, setF] = useState(tier ? { ...tier, sale_start: toLocal(tier.sale_start), sale_end: toLocal(tier.sale_end) } : { tier_name: '', price: '', quota: '', max_per_order: 6, sale_start: '', sale_end: '' });
  const [err, setErr] = useState(null);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    const body = { tier_name: f.tier_name, price: Number(f.price), quota: Number(f.quota), max_per_order: Number(f.max_per_order), sale_start: f.sale_start, sale_end: f.sale_end };
    try {
      if (tier) await api.put(`/festivals/${festivalId}/tiers/${tier.tier_id}`, body); else await api.post(`/festivals/${festivalId}/tiers`, body);
      toast.success('Tier saved'); onSaved();
    } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={tier ? `Edit ${tier.tier_name}` : 'New ticket tier'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {err && <Alert kind="error">{err}</Alert>}
        <div className="form-grid">
          <Field label="Tier name" className="full"><input className="input" required value={f.tier_name} onChange={set('tier_name')} placeholder="Early Bird, General, VIP…" /></Field>
          <Field label="Price (TRY)" hint={tier && tier.sold > 0 ? 'Frozen: tickets already sold' : 'Frozen after the first sale'}><input className="input" type="number" min={0} step="0.01" required value={f.price} onChange={set('price')} disabled={tier && tier.sold > 0} /></Field>
          <Field label="Quota"><input className="input" type="number" min={1} required value={f.quota} onChange={set('quota')} /></Field>
          <Field label="Max per order" hint="1 to 10"><input className="input" type="number" min={1} max={10} required value={f.max_per_order} onChange={set('max_per_order')} /></Field>
          <div />
          <Field label="Sale starts"><input className="input" type="datetime-local" required value={f.sale_start} onChange={set('sale_start')} /></Field>
          <Field label="Sale ends"><input className="input" type="datetime-local" required value={f.sale_end} onChange={set('sale_end')} /></Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save tier</button></div>
      </form>
    </Modal>
  );
}

function Tiers({ festival, tiers, canEdit, reload }) {
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const toast = useToast();
  const quotaSum = tiers.reduce((s, t) => s + Number(t.quota), 0);
  const editable = canEdit && !['COMPLETED', 'CANCELLED'].includes(festival.status);
  return (
    <div className="card">
      <div className="card-head">
        <div><h3>Ticket tiers</h3><p className="small muted">{num(quotaSum)} of {num(festival.daily_capacity)} daily capacity allocated</p></div>
        {editable && festival.status !== 'LIVE' && <button className="btn btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={15} />Add tier</button>}
      </div>
      {tiers.length === 0 ? <Empty icon={Layers} title="No tiers yet">Add at least one tier before opening sales.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tier</th><th className="num">Price</th><th className="num">Quota</th><th className="num">Sold</th><th className="num">Per order</th><th>Sales window</th><th /></tr></thead>
          <tbody>{tiers.map((t) => (
            <tr key={t.tier_id}>
              <td className="bold">{t.tier_name}{t.on_sale_now ? <Badge tone="green">on sale</Badge> : null}</td>
              <td className="num">{money(t.price)}</td><td className="num">{num(t.quota)}</td><td className="num">{num(t.sold)}</td><td className="num">{t.max_per_order}</td>
              <td className="small">{dateTime(t.sale_start)} → {dateTime(t.sale_end)}</td>
              <td className="right nowrap">{editable && <>
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit(t)}><Pencil size={14} /></button>
                {t.sold === 0 && <button className="btn btn-ghost btn-sm" onClick={() => setDel(t)}><Trash2 size={14} /></button>}
              </>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <TierForm festivalId={festival.festival_id} tier={edit.tier_id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(true); }} />}
      {del && <Confirm title={`Delete ${del.tier_name}?`} danger confirmLabel="Delete" onClose={() => setDel(null)}
        onConfirm={async () => { await api.del(`/festivals/${festival.festival_id}/tiers/${del.tier_id}`); toast.success('Tier deleted'); reload(true); }}>
        <p>This tier has no tickets, so it can be removed.</p></Confirm>}
    </div>
  );
}

// ------------------------------------------------------------------ stalls
function StallForm({ festivalId, stall, onClose, onSaved }) {
  const [f, setF] = useState(stall || { stall_code: '', zone: 'FOOD_COURT', size_m2: 10, has_power: true, base_fee: 10000 });
  const [err, setErr] = useState(null);
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    const body = { stall_code: f.stall_code, zone: f.zone, size_m2: Number(f.size_m2), has_power: !!f.has_power, base_fee: Number(f.base_fee) };
    try {
      if (stall) await api.put(`/festivals/${festivalId}/stalls/${stall.stall_id}`, body); else await api.post(`/festivals/${festivalId}/stalls`, body);
      toast.success('Stall saved'); onSaved();
    } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={stall ? `Edit stall ${stall.stall_code}` : 'Add stall to site map'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {err && <Alert kind="error">{err}</Alert>}
        <div className="form-grid">
          <Field label="Stall code" hint="e.g. F-12"><input className="input mono" required maxLength={10} value={f.stall_code} onChange={(e) => setF({ ...f, stall_code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Zone"><select className="select" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}>{['FOOD_COURT', 'MAIN_STAGE', 'CAMPING', 'ENTRANCE'].map((z) => <option key={z} value={z}>{label(z)}</option>)}</select></Field>
          <Field label="Size (m²)"><input className="input" type="number" step="0.01" min={0.5} required value={f.size_m2} onChange={(e) => setF({ ...f, size_m2: e.target.value })} /></Field>
          <Field label="Base fee (TRY)"><input className="input" type="number" step="0.01" min={0} required value={f.base_fee} onChange={(e) => setF({ ...f, base_fee: e.target.value })} /></Field>
          <label className="checkbox"><input type="checkbox" checked={!!f.has_power} onChange={(e) => setF({ ...f, has_power: e.target.checked })} />Power supply</label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save stall</button></div>
      </form>
    </Modal>
  );
}

function ApproveModal({ a, onClose, onDone }) {
  const [fee, setFee] = useState(a.agreed_fee);
  const [err, setErr] = useState(null);
  const toast = useToast();
  return (
    <Modal title={`Approve ${a.legal_name} for ${a.stall_code}`} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>Cancel</button>
      <button className="btn btn-success" onClick={async () => { try { await api.post(`/allocations/${a.allocation_id}/approve`, { agreed_fee: Number(fee) }); toast.success('Application approved'); onDone(); } catch (x) { setErr(x.message); } }}><Check size={15} />Approve</button>
    </>}>
      <div className="stack">
        <Field label="Agreed fee (TRY)" hint={`Base fee ${money(a.base_fee)}. The vendor has 7 days to pay after approval.`}><input className="input" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
        <p className="small muted">Other open applications for this stall will be rejected automatically.</p>
        {err && <Alert kind="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

function Stalls({ festival, canEdit }) {
  const map = useFetch(() => api.get(`/festivals/${festival.festival_id}/stalls`), [festival.festival_id]);
  const apps = useFetch(() => api.get(`/festivals/${festival.festival_id}/allocations`), [festival.festival_id]);
  const [edit, setEdit] = useState(null);
  const [approve, setApprove] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const toast = useToast();
  const reloadAll = () => { map.reload(true); apps.reload(true); };
  if (map.loading || apps.loading) return <Loading />;
  if (map.error) return <ErrorState error={map.error} />;
  const editable = canEdit && !['COMPLETED', 'CANCELLED'].includes(festival.status);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h3>Site map</h3>{editable && <button className="btn btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={15} />Add stall</button>}</div>
        <div className="card-body">
          {map.data.stalls.length === 0 ? <Empty icon={MapPinned} title="No stalls yet">Publish stalls so vendors can apply.</Empty>
            : <StallMap stalls={map.data.stalls} showVendor onPick={editable ? (s) => setEdit(s) : null} />}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Applications</h3><span className="small muted">one approved vendor per stall · max 2 stalls per vendor</span></div>
        {apps.data.allocations.length === 0 ? <Empty icon={MapPinned} title="No applications yet" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Stall</th><th>Vendor</th><th className="num">Fee</th><th>Status</th><th>Payment</th><th /></tr></thead>
            <tbody>{apps.data.allocations.map((a) => (
              <tr key={a.allocation_id}>
                <td><b className="mono">{a.stall_code}</b><div className="tiny muted">{label(a.zone)}</div></td>
                <td>{a.legal_name}<div className="tiny muted">{label(a.category)} · VKN {a.tax_number}</div></td>
                <td className="num">{money(a.agreed_fee)}</td>
                <td><Badge value={a.status} />{a.reviewer_name && <div className="tiny muted mt-1">by {a.reviewer_name}</div>}</td>
                <td className="small">{a.status === 'APPROVED' ? (Number(a.paid_amount) >= Number(a.agreed_fee) ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Due {dateTime(a.fee_due_at)}</Badge>) : Number(a.refunded_amount) > 0 ? `Refunded ${money(a.refunded_amount)}` : '—'}</td>
                <td className="right nowrap">{canEdit && <>
                  {a.status === 'APPLIED' && <><button className="btn btn-success btn-sm" onClick={() => setApprove(a)}><Check size={14} />Approve</button> <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ a, kind: 'reject' })}><X size={14} />Reject</button></>}
                  {a.status === 'APPROVED' && <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ a, kind: 'cancel' })}><Ban size={14} />Annul</button>}
                </>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {edit && <StallForm festivalId={festival.festival_id} stall={edit.stall_id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadAll(); }} />}
      {approve && <ApproveModal a={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); reloadAll(); }} />}
      {confirm && <Confirm title={confirm.kind === 'reject' ? 'Reject application?' : 'Annul allocation?'} danger confirmLabel={confirm.kind === 'reject' ? 'Reject' : 'Annul'} onClose={() => setConfirm(null)}
        onConfirm={async () => { await api.post(`/allocations/${confirm.a.allocation_id}/${confirm.kind}`); toast.success('Done'); reloadAll(); }}>
        <p>{confirm.kind === 'reject' ? `${confirm.a.legal_name}'s application for ${confirm.a.stall_code} will be rejected.` : `Organizer-initiated cancellations refund the vendor's paid fee in full (${money(Number(confirm.a.paid_amount) - Number(confirm.a.refunded_amount))}).`}</p>
      </Confirm>}
    </div>
  );
}

// --------------------------------------------------------------- attendees
export function TrailModal({ ticketId, onClose }) {
  const { data, loading, error } = useFetch(() => analytics.get(`/tickets/${ticketId}/trail`), [ticketId]);
  return (
    <Modal title="Ticket audit trail" wide onClose={onClose}>
      {loading ? <Loading /> : error ? <Alert kind="error">{error.message}</Alert> : (
        <div className="grid grid-2">
          <div className="stack-sm">
            <p className="mono tiny muted">{data.ticket.ticket_id}</p>
            <h3>{data.ticket.festival_name} · {data.ticket.tier_name}</h3>
            <div className="row"><Badge value={data.ticket.status} /><Badge value={data.ticket.order_status} /></div>
            <div className="summary-line small"><span>Bought by</span><b>{data.ticket.buyer_name}</b></div>
            <div className="summary-line small"><span>Current holder</span><b>{data.ticket.holder_name}</b></div>
            <div className="summary-line small"><span>Order</span><span>#{data.ticket.order_id} · {dateTime(data.ticket.ordered_at)}</span></div>
            <p className="small bold mt-1">Payments</p>
            {data.payments.map((p) => <div key={p.payment_id} className="summary-line small"><span><Badge value={p.payment_type} /> <span className="mono tiny">{p.provider_ref}</span></span><span>{money(p.amount)}</span></div>)}
          </div>
          <div className="timeline">
            <div className="tl-item"><b>Issued</b><div className="small muted">{dateTime(data.ticket.issued_at)}</div></div>
            {data.transfers.map((t, i) => <div key={i} className="tl-item"><b>Transferred</b><div className="small muted">{dateTime(t.transferred_at)} · {t.from_name} → {t.to_name}</div></div>)}
            {data.scans.map((s, i) => <div key={`s${i}`} className={`tl-item ${s.result === 'ACCEPTED' ? 'green' : 'red'}`}><b>{s.direction} · {s.gate_code}</b> <Badge value={s.result} /><div className="small muted">{dateTime(s.scanned_at)} · {s.staff_name}</div></div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Attendees({ festival, canEdit }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch(() => analytics.get(`/festivals/${festival.festival_id}/attendees${qs({ q, status })}`), [festival.festival_id, q, status]);
  const [trail, setTrail] = useState(null);
  const [refund, setRefund] = useState(null);
  const toast = useToast();
  return (
    <div className="card">
      <div className="card-head">
        <div className="row" style={{ flex: 1 }}>
          <div className="input-icon" style={{ flex: '1 1 240px', maxWidth: 360 }}><Search size={16} /><input className="input" placeholder="Name, email or ticket id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" style={{ width: 'auto', minWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>{['VALID', 'CHECKED_IN', 'REFUNDED', 'VOID'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => analytics.download(`/festivals/${festival.festival_id}/attendees${qs({ q, status })}`, `attendees-${festival.festival_id}.csv`).catch((e) => toast.error(e.message))}><Download size={15} />Export CSV</button>
      </div>
      {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : data.attendees.length === 0 ? <Empty icon={Users} title="No attendees found" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Holder</th><th>Tier</th><th>Status</th><th>Age</th><th>Bought by</th><th>Last scan</th><th /></tr></thead>
          <tbody>{data.attendees.map((a) => (
            <tr key={a.ticket_id}>
              <td><b>{a.holder_name}</b><div className="tiny muted">{a.holder_email}</div></td>
              <td>{a.tier_name}<div className="tiny muted">{money(a.price)}</div></td>
              <td><Badge value={a.ticket_status} />{a.transferred ? <div className="tiny muted mt-1">transferred</div> : null}</td>
              <td>{a.age_at_start}</td>
              <td className="small">{a.buyer_name}</td>
              <td className="small">{a.last_scan ? <><Badge value={a.last_scan} /> {dateTime(a.last_scan_at)}</> : '—'}</td>
              <td className="right nowrap">
                <button className="btn btn-ghost btn-sm" onClick={() => setTrail(a.ticket_id)} title="Audit trail"><FileSearch size={14} /></button>
                {canEdit && a.ticket_status === 'VALID' && a.order_status === 'PAID' && <button className="btn btn-ghost btn-sm" onClick={() => setRefund(a)} title="Refund"><Undo2 size={14} /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {trail && <TrailModal ticketId={trail} onClose={() => setTrail(null)} />}
      {refund && <Confirm title="Refund this ticket?" danger confirmLabel="Issue refund" onClose={() => setRefund(null)}
        onConfirm={async () => { const r = await api.post(`/tickets/${refund.ticket_id}/refund`); toast.success(`${money(r.amount)} refunded (${Math.round(r.rate * 100)}%)`); reload(true); }}>
        <p>{refund.holder_name}'s {refund.tier_name} ticket will be refunded by the standard schedule (90% at 30+ days, 50% at 7 to 29 days) and its QR code disabled.</p>
      </Confirm>}
    </div>
  );
}

// ------------------------------------------------------------------- scans
function Scans({ festival }) {
  const [result, setResult] = useState('');
  const { data, loading, error } = useFetch(() => analytics.get(`/scans${qs({ festival_id: festival.festival_id, result })}`), [festival.festival_id, result]);
  const toast = useToast();
  return (
    <div className="card">
      <div className="card-head">
        <select className="select" style={{ width: 'auto', minWidth: 220 }} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>{['ACCEPTED', 'REJECTED_DUPLICATE', 'REJECTED_INVALID', 'REJECTED_NOT_LIVE'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={() => analytics.download(`/scans${qs({ festival_id: festival.festival_id, result })}`, `scans-${festival.festival_id}.csv`).catch((e) => toast.error(e.message))}><Download size={15} />Export CSV</button>
      </div>
      {loading ? <Loading /> : error ? <ErrorState error={error} /> : data.scans.length === 0 ? <Empty icon={ScanLine} title="No gate scans yet" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Time</th><th>Gate</th><th>Direction</th><th>Result</th><th>Holder</th><th>Staff</th></tr></thead>
          <tbody>{data.scans.slice(0, 300).map((s) => (
            <tr key={s.scan_id}><td className="nowrap small">{dateTime(s.scanned_at)}</td><td className="mono">{s.gate_code}</td><td><Badge value={s.direction} /></td><td><Badge value={s.result} /></td><td>{s.holder_name}<div className="tiny muted">{s.tier_name}</div></td><td className="small">{s.staff_name}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- page
export default function FestivalAdmin() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => api.get(`/festivals/${id}`), [id]);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [statusTo, setStatusTo] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [version, setVersion] = useState(0);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { festival: f, tiers, next_statuses: next } = data;
  const canEdit = user.role === 'ORGANIZER' && f.organizer_id === user.user_id;

  const statusText = {
    ON_SALE: `Tickets go on sale in each tier's sales window. ${tiers.length} tier(s) configured.`,
    LIVE: 'Gates open: staff can admit ticket holders. Online sales stop.',
    COMPLETED: 'The festival is closed. This is final.',
    CANCELLED: 'Every non-refunded ticket is refunded at 100% (one refund payment per order), pending checkouts are voided, and every approved stall allocation is annulled with its fee reimbursed in full. This cannot be undone.',
  };

  return (
    <>
      <Link to="/admin/festivals" className="btn btn-ghost btn-sm mb-1"><ArrowLeft size={15} />All festivals</Link>
      <div className="page-head">
        <div>
          <div className="row"><h1>{f.name}</h1><Badge value={f.status} /></div>
          <p>{f.venue_name}, {f.city} · {dateRange(f.start_date, f.end_date)} · {num(f.daily_capacity)}/day · {f.min_age}+</p>
        </div>
        {canEdit && (
          <div className="row">
            {f.status === 'DRAFT' && <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(true)}><Trash2 size={15} />Delete</button>}
            {!['COMPLETED', 'CANCELLED'].includes(f.status) && <button className="btn btn-outline" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button>}
            {next.map((s) => { const A = STATUS_ACTIONS[s]; return <button key={s} className={`btn ${A.cls}`} onClick={() => setStatusTo(s)}><A.icon size={15} />{A.label}</button>; })}
          </div>
        )}
      </div>
      {f.status === 'CANCELLED' && <div className="mb-2"><Alert kind="error">This festival was cancelled. All tickets were refunded in full and stall allocations annulled.</Alert></div>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'tiers', label: 'Ticket tiers', icon: Layers, count: tiers.length },
        { id: 'stalls', label: 'Stalls & vendors', icon: MapPinned },
        { id: 'attendees', label: 'Attendees', icon: Users },
        { id: 'scans', label: 'Gate scans', icon: ScanLine },
      ]} />
      <div key={`${f.status}-${version}`}>
        {tab === 'overview' && <Overview festivalId={f.festival_id} />}
        {tab === 'tiers' && <Tiers festival={f} tiers={tiers} canEdit={canEdit} reload={reload} />}
        {tab === 'stalls' && <Stalls festival={f} canEdit={canEdit} />}
        {tab === 'attendees' && <Attendees festival={f} canEdit={canEdit} />}
        {tab === 'scans' && <Scans festival={f} />}
      </div>

      {editing && <FestivalForm festival={f} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(true); setVersion((v) => v + 1); }} />}
      {statusTo && (
        <Confirm title={STATUS_ACTIONS[statusTo].label} danger={statusTo === 'CANCELLED'} confirmLabel={STATUS_ACTIONS[statusTo].label} onClose={() => setStatusTo(null)}
          onConfirm={async () => {
            const r = await api.post(`/festivals/${f.festival_id}/status`, { status: statusTo });
            if (r.summary) toast.success(`Cancelled: ${r.summary.tickets_refunded} tickets refunded (${money(r.summary.amount_refunded)}), ${r.summary.allocations_cancelled} stalls annulled`);
            else toast.success(`Festival is now ${label(statusTo)}`);
            reload(true);
            setVersion((v) => v + 1);
          }}>
          <p>{statusText[statusTo]}</p>
        </Confirm>
      )}
      {deleting && <Confirm title="Delete draft festival?" danger confirmLabel="Delete" onClose={() => setDeleting(false)}
        onConfirm={async () => { await api.del(`/festivals/${f.festival_id}`); toast.success('Draft deleted'); nav('/admin/festivals'); }}>
        <p>The draft and its tiers will be removed.</p></Confirm>}
    </>
  );
}
