import { useState } from 'react';
import { CreditCard, Landmark, Wallet, Lock } from 'lucide-react';
import { Alert, Field } from './ui';
import { money } from '../lib/format';

const METHODS = [
  { id: 'CARD', label: 'Card', icon: CreditCard },
  { id: 'BANK_TRANSFER', label: 'Bank transfer', icon: Landmark },
  { id: 'WALLET', label: 'Wallet', icon: Wallet },
];

/** Simulated payment gateway form. Card numbers ending in 0002 are declined. */
export default function PaymentForm({ amount, onPay, disabled, cta = 'Pay' }) {
  const [method, setMethod] = useState('CARD');
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [exp, setExp] = useState('12/29');
  const [cvc, setCvc] = useState('123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onPay({ method, card_number: method === 'CARD' ? card : undefined }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="methods">
        {METHODS.map((m) => (
          <button type="button" key={m.id} className={`method ${method === m.id ? 'on' : ''}`} onClick={() => setMethod(m.id)}>
            <m.icon size={20} />{m.label}
          </button>
        ))}
      </div>
      {method === 'CARD' && (
        <div className="form-grid">
          <Field label="Card number" className="full" hint="Test mode: any number works; one ending in 0002 is declined.">
            <input className="input mono" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value.replace(/[^\d ]/g, '').slice(0, 23))} required />
          </Field>
          <Field label="Expiry"><input className="input" value={exp} onChange={(e) => setExp(e.target.value)} placeholder="MM/YY" required /></Field>
          <Field label="CVC"><input className="input" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))} required /></Field>
        </div>
      )}
      {method === 'BANK_TRANSFER' && <Alert>In test mode the transfer is confirmed instantly by the simulated gateway.</Alert>}
      {method === 'WALLET' && <Alert>You'll be charged from your FestPass wallet (simulated).</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-grad btn-lg" disabled={busy || disabled}><Lock size={16} />{busy ? 'Processing…' : `${cta} ${money(amount)}`}</button>
    </form>
  );
}
