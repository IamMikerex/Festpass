import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { CalendarDays, MapPin, QrCode, Send, Undo2, History, Ticket, User, Sun, Moon } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Empty, ErrorState, Field, Loading, Modal, useToast } from '../components/ui';
import { dateRange, dateTime, money, label } from '../lib/format';

function QrModal({ ticketId, onClose }) {
  const { data, loading, error } = useFetch(() => api.get(`/tickets/${ticketId}`), [ticketId]);
  const [bright, setBright] = useState(true);
  const t = data?.ticket;
  return (
    <Modal title="Your entry QR" onClose={onClose}>
      {loading ? <Loading /> : error ? <Alert kind="error">{error.message}</Alert> : (
        <div className="qr-wrap stack" style={{ background: bright ? 'transparent' : '#0f0a24', borderRadius: 16, padding: bright ? 0 : 16 }}>
          {t.qr_token ? (
            <>
              <div><div className="qr-big"><QRCodeSVG value={t.qr_token} size={240} level="M" includeMargin={false} /></div></div>
              <div style={{ color: bright ? 'inherit' : '#fff' }}>
                <h3>{t.festival_name}</h3>
                <p className="small" style={{ opacity: 0.7 }}>{t.tier_name} · {t.holder_name}</p>
              </div>
              <p className="code-line">Ticket {t.ticket_id}</p>
              <Alert kind="info">Show this code at the gate. Screenshots stop working if the ticket is transferred, and each code lets one person in at a time.</Alert>
              <button className="btn btn-outline btn-sm" style={{ alignSelf: 'center' }} onClick={() => setBright((b) => !b)}>
                {bright ? <Moon size={14} /> : <Sun size={14} />}{bright ? 'Dark background' : 'Light background'}
              </button>
            </>
          ) : <Alert kind="warning">This ticket has no active QR code ({label(t.status)}).</Alert>}
        </div>
      )}
    </Modal>
  );
}

function TransferModal({ ticket, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/tickets/${ticket.ticket_id}/transfer`, { email });
      toast.success(`Ticket sent to ${r.to_name}`);
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title="Transfer ticket" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p>Send your <b>{ticket.tier_name}</b> ticket for <b>{ticket.festival_name}</b> to another FestPass user.</p>
        <Alert kind="warning">A ticket can be transferred only once, and only until 48 hours before the festival. Your current QR code stops working immediately and the recipient gets a new one. This can't be undone.</Alert>
        <Field label="Recipient's FestPass email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@email.com" /></Field>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}><Send size={15} />{busy ? 'Sending…' : 'Transfer ticket'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RefundModal({ ticket, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/tickets/${ticket.ticket_id}/refund`);
      toast.success(`${money(r.amount)} refunded to your original payment method`);
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const rate = Number(ticket.refund_rate);
  return (
    <Modal title="Request a refund" onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>Keep ticket</button>
      <button className="btn btn-danger" onClick={go} disabled={busy}><Undo2 size={15} />{busy ? 'Refunding…' : `Refund ${money(ticket.refund_amount)}`}</button>
    </>}>
      <div className="stack">
        <p>{ticket.festival_name} starts in <b>{ticket.days_before_start} days</b>, so you're in the <b>{Math.round(rate * 100)}%</b> refund band.</p>
        <div className="card card-pad">
          <div className="summary-line"><span>Ticket price ({ticket.tier_name})</span><span>{money(ticket.price)}</span></div>
          <div className="summary-line"><span>Refund rate</span><span>{Math.round(rate * 100)}%</span></div>
          <div className="summary-total"><span>You get back</span><span>{money(ticket.refund_amount)}</span></div>
        </div>
        <p className="small muted">90% when 30+ days before, 50% when 7–29 days before, no refund in the last 7 days. The ticket is cancelled and its QR code stops working.</p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function HistoryModal({ ticket, onClose }) {
  const { data, loading } = useFetch(() => api.get(`/tickets/${ticket.ticket_id}/history`), [ticket.ticket_id]);
  return (
    <Modal title="Ticket history" onClose={onClose}>
      {loading ? <Loading /> : (
        <div className="timeline">
          <div className="tl-item"><b>Issued</b><div className="small muted">{dateTime(ticket.issued_at)} · bought by {ticket.buyer_name}</div></div>
          {data.transfers.map((t, i) => (
            <div key={`t${i}`} className="tl-item"><b>Transferred</b><div className="small muted">{dateTime(t.transferred_at)} · {t.from_name} → {t.to_name}</div></div>
          ))}
          {data.scans.slice().reverse().map((s, i) => (
            <div key={`s${i}`} className={`tl-item ${s.result === 'ACCEPTED' ? 'green' : 'red'}`}>
              <b>{s.direction === 'IN' ? 'Entry' : 'Exit'} at {s.gate_code}</b> <Badge value={s.result} />
              <div className="small muted">{dateTime(s.scanned_at)}</div>
            </div>
          ))}
          {!data.transfers.length && !data.scans.length && <p className="small muted">No transfers or gate scans yet.</p>}
        </div>
      )}
    </Modal>
  );
}

function TicketCard({ t, me, onAction }) {
  const active = ['VALID', 'CHECKED_IN'].includes(t.status) && t.order_status === 'PAID';
  const inside = t.last_scan_direction === 'IN';
  return (
    <div className={`ticket ${active ? '' : 'dim'}`}>
      <div className="ticket-band" />
      <div className="ticket-main">
        <div className="row-between">
          <div className="row"><Badge value={t.status} />{t.festival_status !== 'ON_SALE' && <Badge value={t.festival_status} />}{inside && <Badge tone="blue">Inside now</Badge>}</div>
          <span className="tier-price" style={{ fontSize: 16 }}>{t.tier_name}</span>
        </div>
        <h3><Link to={`/festivals/${t.festival_id}`} style={{ color: 'inherit' }}>{t.festival_name}</Link></h3>
        <div className="ticket-meta">
          <span><CalendarDays size={14} />{dateRange(t.start_date, t.end_date)}</span>
          <span><MapPin size={14} />{t.venue_name}, {t.city}</span>
          <span><User size={14} />{t.holder_name}{t.buyer_id !== me.user_id && ` (from ${t.buyer_name})`}</span>
        </div>
        <div className="ticket-actions">
          {active && <button className="btn btn-primary btn-sm" onClick={() => onAction('qr', t)}><QrCode size={15} />Show QR</button>}
          {t.can_transfer
            ? <button className="btn btn-outline btn-sm" onClick={() => onAction('transfer', t)}><Send size={15} />Transfer</button>
            : active && <button className="btn btn-outline btn-sm" disabled title={t.transfer_block_reason || ''}><Send size={15} />Transfer</button>}
          {t.can_refund
            ? <button className="btn btn-outline btn-sm" onClick={() => onAction('refund', t)}><Undo2 size={15} />Refund {Math.round(t.refund_rate * 100)}%</button>
            : active && <button className="btn btn-outline btn-sm" disabled title={t.refund_block_reason || ''}><Undo2 size={15} />Refund</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => onAction('history', t)}><History size={15} />History</button>
        </div>
        {active && (t.transfer_block_reason || t.refund_block_reason) && (
          <p className="tiny faint">{[t.transfer_block_reason, t.refund_block_reason].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      <div className="ticket-side">
        <div className={`qr-mini ${active ? '' : 'blur'}`} onClick={() => active && onAction('qr', t)} role="button" aria-label="Show QR">
          <QrCode size={56} color="#17142b" />
        </div>
        <span className="tiny faint mono">{t.ticket_id.slice(0, 8).toUpperCase()}</span>
      </div>
    </div>
  );
}

export default function MyTickets() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => api.get('/tickets'), []);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('upcoming');
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const done = () => { setModal(null); reload(true); };
  const upcoming = data.tickets.filter((t) => ['ON_SALE', 'LIVE', 'DRAFT'].includes(t.festival_status) && ['VALID', 'CHECKED_IN'].includes(t.status));
  const other = data.tickets.filter((t) => !upcoming.includes(t));
  const list = tab === 'upcoming' ? upcoming : other;

  return (
    <>
      <div className="page-head">
        <div><h1>My tickets</h1><p>Named tickets you hold. Tap a QR code at the gate.</p></div>
        <div className="segmented">
          <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>Upcoming ({upcoming.length})</button>
          <button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Past & refunded ({other.length})</button>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon={Ticket} title={tab === 'upcoming' ? 'No upcoming tickets' : 'Nothing here yet'} action={<Link to="/festivals" className="btn btn-primary">Find a festival</Link>}>
          Tickets you buy or receive from friends show up here.
        </Empty></div>
      ) : (
        <div className="stack">{list.map((t) => <TicketCard key={t.ticket_id} t={t} me={user} onAction={(kind, tk) => setModal({ kind, t: tk })} />)}</div>
      )}
      {modal?.kind === 'qr' && <QrModal ticketId={modal.t.ticket_id} onClose={() => setModal(null)} />}
      {modal?.kind === 'transfer' && <TransferModal ticket={modal.t} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'refund' && <RefundModal ticket={modal.t} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'history' && <HistoryModal ticket={modal.t} onClose={() => setModal(null)} />}
    </>
  );
}
