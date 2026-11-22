const crypto = require('crypto');

/**
 * Simulated payment gateway. In production this would call the PSP (iyzico, Stripe...).
 * Test rule: a card number ending in 0002 is declined, everything else is captured.
 */
function charge({ method, cardNumber }) {
  const providerRef = `FP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const digits = String(cardNumber || '').replace(/\D/g, '');
  const declined = method === 'CARD' && digits.endsWith('0002');
  return { providerRef, status: declined ? 'FAILED' : 'CAPTURED', declineReason: declined ? 'Card declined by issuer' : null };
}

function refund() {
  return { providerRef: `RF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, status: 'CAPTURED' };
}

const newQrToken = () => crypto.randomBytes(32).toString('hex'); // 256-bit hex, CHAR(64)

module.exports = { charge, refund, newQrToken };
