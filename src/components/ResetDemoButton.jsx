import { RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

const TABLE_LABELS = { paypal_orders: 'orders', paypal_payments: 'payments', seat_proposals: 'proposals', paypal_webhook_events: 'PayPal events', agent_actions: 'assistant log rows', user_entitlements: 'entitlements' };

export function resetSummary(deleted) {
  const parts = Object.entries(deleted).filter(([, count]) => count > 0).map(([table, count]) => `${count} ${TABLE_LABELS[table] ?? table}`);
  return parts.length ? `Demo data reset: ${parts.join(', ')} removed.` : 'Demo data reset: nothing to remove.';
}

// "Reset demo data" in the top bar: a confirm dialog, then POST /api/demo/reset, which deletes
// only the signed-in instructor's own sandbox rows and clears their entitlement.
export default function ResetDemoButton({ authHeaders, onReset }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmRef = useRef(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  async function reset() {
    setBusy(true);
    setError('');
    try {
      const result = await readResponse(await fetch('/api/demo/reset', { method: 'POST', headers: authHeaders() }));
      setOpen(false);
      onReset(resetSummary(result.deleted));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="events-toggle" onClick={() => setOpen(true)}><RotateCcw size={13} />Reset demo data</button>
      {open && (
        <div className="confirm-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={(event) => event.stopPropagation()}>
            <div className="events-head">
              <div><p className="eyebrow">SANDBOX ONLY</p><h2 id="reset-title">Reset demo data?</h2></div>
              <button type="button" className="events-close" onClick={() => setOpen(false)} aria-label="Close" disabled={busy}><X size={16} /></button>
            </div>
            <p className="events-note">This deletes your own sandbox seat orders, payments, proposals, PayPal events and assistant log, and clears your seat entitlement. Other accounts and PayPal's sandbox records are not touched.</p>
            {error && <p className="notice" role="alert">{error}</p>}
            <div className="confirm-actions">
              <button ref={confirmRef} type="button" className="checkout-button" onClick={reset} disabled={busy}>{busy ? 'Resetting…' : 'Reset my demo data'}</button>
              <button type="button" className="agent-cancel" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
