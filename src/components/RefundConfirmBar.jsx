import { Check, X } from 'lucide-react';
import { useState } from 'react';

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

// What a successful refund says in the chat or notice.
export function refundIssuedMessage(result) {
  const seats = result.quantity === 1 ? '1 seat' : `${result.quantity} seats`;
  const state = result.revoked
    ? `${seats} for ${result.className} revoked.`
    : `PayPal reports it as ${result.status}; the seats are revoked when PayPal confirms the refund.`;
  return `Refund ${result.refundId} issued for ${result.currency} ${result.amount}. ${state}`;
}

// The Confirm gate for an agent-proposed refund. Shows the capture ID and amount; only the Confirm
// click calls the refund endpoint, which checks ownership again and issues the sandbox refund.
export default function RefundConfirmBar({ proposal, authHeaders, onIssued, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const result = await readResponse(await fetch(`/api/paypal/captures/${encodeURIComponent(proposal.captureId)}/refund`, {
        method: 'POST',
        headers: authHeaders(),
      }));
      onIssued(result);
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }

  return (
    <div className="seat-confirm-bar refund" role="group" aria-label="Refund awaiting confirmation">
      <div>
        <strong>Refund proposed</strong>
        <span>Capture <code>{proposal.captureId}</code> · {proposal.quantity} seats · {proposal.className} · <strong>{proposal.currency} {proposal.amount} full refund</strong></span>
        {error && <span className="seat-confirm-error" role="alert">{error}</span>}
      </div>
      <div>
        <button className="checkout-button" type="button" onClick={confirm} disabled={busy}><Check size={14} />{busy ? 'Refunding…' : 'Confirm refund'}</button>
        <button className="agent-cancel" type="button" onClick={onDismiss} disabled={busy}><X size={14} />Cancel</button>
      </div>
    </div>
  );
}
