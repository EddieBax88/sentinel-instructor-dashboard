import { Radio, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { eventLabel, formatAmount, startPolling } from './eventDrawerModel.js';

const timeOf = (value) => (value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '');

// Live feed of verified PayPal webhook events for the signed-in instructor's own orders. Polls
// GET /api/paypal/events every 5 seconds, and only while the drawer is open.
export default function EventDrawer({ accessToken }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !accessToken) return undefined;
    return startPolling(async () => {
      const response = await fetch('/api/paypal/events', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'PayPal events could not be loaded.');
      return payload.events;
    }, {
      onEvents: (next) => {
        setEvents(next);
        setError('');
      },
      onError: (loadError) => setError(loadError.message),
    });
  }, [open, accessToken]);

  if (!accessToken) return null;

  return (
    <>
      <button type="button" className="events-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="paypal-events">
        <Radio size={13} />PayPal events
      </button>
      {open && (
        <aside id="paypal-events" className="events-drawer" aria-label="PayPal webhook events">
          <div className="events-head">
            <div><p className="eyebrow">LIVE · VERIFIED WEBHOOKS</p><h2>PayPal events</h2></div>
            <button type="button" className="events-close" onClick={() => setOpen(false)} aria-label="Close PayPal events"><X size={16} /></button>
          </div>
          <p className="events-note">Events PayPal sends for your orders, after signature verification. Refreshes every 5 seconds while open.</p>
          {error && <p className="notice" role="alert">{error}</p>}
          {events === null && !error && <p className="events-empty">Loading…</p>}
          {events?.length === 0 && <p className="events-empty">No PayPal events yet. They appear here when PayPal sends a webhook for one of your orders.</p>}
          {events?.length > 0 && (
            <ol className="events-list">
              {events.map((event) => (
                <li key={event.eventId}>
                  <div className="events-row">
                    <strong>{eventLabel(event.eventType)}</strong>
                    <time dateTime={event.receivedAt}>{timeOf(event.receivedAt)}</time>
                  </div>
                  <div className="events-meta">
                    {event.status && <span>{event.status}</span>}
                    {event.amount !== null && <span>{formatAmount(event.amount, event.currency)}</span>}
                    {event.orderId && <span>Order {event.orderId}</span>}
                  </div>
                  <code>{event.eventType}</code>
                </li>
              ))}
            </ol>
          )}
        </aside>
      )}
    </>
  );
}
