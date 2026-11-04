// Plain logic behind the PayPal event drawer, kept out of the component so it can be tested in Node.

export const POLL_INTERVAL_MS = 5000;

const EVENT_LABELS = {
  'CHECKOUT.ORDER.APPROVED': 'Order approved',
  'CHECKOUT.ORDER.COMPLETED': 'Order completed',
  'PAYMENT.CAPTURE.COMPLETED': 'Payment captured',
  'PAYMENT.CAPTURE.PENDING': 'Payment pending',
  'PAYMENT.CAPTURE.DENIED': 'Payment denied',
  'PAYMENT.CAPTURE.DECLINED': 'Payment declined',
  'PAYMENT.CAPTURE.REFUNDED': 'Payment refunded',
  'PAYMENT.CAPTURE.REVERSED': 'Payment reversed',
};

export const eventLabel = (eventType) => EVENT_LABELS[eventType] ?? eventType;

export function formatAmount(amount, currency) {
  if (amount === null || amount === undefined) return '';
  return currency ? `${currency} ${Number(amount).toFixed(2)}` : Number(amount).toFixed(2);
}

// Loads now, then every intervalMs until stopped. A load still in flight is not started again,
// and nothing is reported after stop.
export function startPolling(load, { intervalMs = POLL_INTERVAL_MS, onEvents, onError, timers = globalThis } = {}) {
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const events = await load();
      if (!stopped) onEvents?.(events);
    } catch (error) {
      if (!stopped) onError?.(error);
    } finally {
      inFlight = false;
    }
  };
  tick();
  const timer = timers.setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    timers.clearInterval(timer);
  };
}
