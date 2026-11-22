import { useState } from 'react';
import { api } from '../../lib/api';
import { Alert, Field, Modal, useToast } from '../../components/ui';

const EMPTY = { name: '', venue_name: '', city: '', start_date: '', end_date: '', daily_capacity: 1000, min_age: 16 };

export default function FestivalForm({ festival, onClose, onSaved }) {
  const [f, setF] = useState(festival ? { ...EMPTY, ...festival } : EMPTY);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const body = { name: f.name, venue_name: f.venue_name, city: f.city, start_date: f.start_date, end_date: f.end_date, daily_capacity: Number(f.daily_capacity), min_age: Number(f.min_age) };
    try {
      const r = festival ? await api.put(`/festivals/${festival.festival_id}`, body) : await api.post('/festivals', body);
      toast.success(festival ? 'Festival updated' : 'Festival created as a draft');
      onSaved(festival ? festival.festival_id : r.festival_id);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={festival ? 'Edit festival' : 'New festival'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {err && <Alert kind="error">{err}</Alert>}
        <Field label="Name"><input className="input" required value={f.name} onChange={set('name')} placeholder="e.g. Istanbul Sound Festival" /></Field>
        <div className="form-grid">
          <Field label="Venue"><input className="input" required value={f.venue_name} onChange={set('venue_name')} /></Field>
          <Field label="City"><input className="input" required value={f.city} onChange={set('city')} /></Field>
          <Field label="Start date"><input className="input" type="date" required value={f.start_date} onChange={set('start_date')} /></Field>
          <Field label="End date"><input className="input" type="date" required value={f.end_date} min={f.start_date} onChange={set('end_date')} /></Field>
          <Field label="Daily capacity" hint="Sum of all tier quotas can't exceed this"><input className="input" type="number" min={1} required value={f.daily_capacity} onChange={set('daily_capacity')} /></Field>
          <Field label="Minimum age" hint="0 to 21"><input className="input" type="number" min={0} max={21} required value={f.min_age} onChange={set('min_age')} /></Field>
        </div>
        {festival && festival.status !== 'DRAFT' && <Alert kind="warning">Dates and age limit lock once tickets are sold.</Alert>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : festival ? 'Save changes' : 'Create draft'}</button>
        </div>
      </form>
    </Modal>
  );
}
