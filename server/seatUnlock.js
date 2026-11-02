import { DEFAULT_CLASS_SIZE } from './config.js';

export const COHORT = Object.freeze({
  id: 'sentinel-fall-2026',
  name: 'Sentinel Fall 2026',
  classSize: DEFAULT_CLASS_SIZE,
});

// Class names as typed: trimmed, inner whitespace collapsed, first letter capitalised, the rest
// as the instructor wrote it ("fall class" becomes "Fall class", "Fall Journeyman Class" stays).
export function tidyClassName(text) {
  const collapsed = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
  return collapsed ? collapsed[0].toUpperCase() + collapsed.slice(1) : '';
}

const classKey = (text) => tidyClassName(text).toLowerCase();

// One display name per class across an instructor's rows, so "fall class" and "Fall class" group
// as one class in the ledger, the analytics grids and the Studio charts. The stored rows keep
// their text; this only decides what is shown. For each case-insensitive key the most frequent
// spelling (first letter capitalised) wins; a tie is settled alphabetically.
export function canonicalClassNames(names) {
  const variants = new Map();
  for (const raw of names) {
    const tidy = tidyClassName(raw);
    if (!tidy) continue;
    const key = tidy.toLowerCase();
    const counts = variants.get(key) ?? new Map();
    counts.set(tidy, (counts.get(tidy) ?? 0) + 1);
    variants.set(key, counts);
  }
  const canonical = new Map();
  for (const [key, counts] of variants) {
    const [best] = [...counts.entries()].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
    canonical.set(key, best[0]);
  }
  return (raw) => canonical.get(classKey(raw)) ?? tidyClassName(raw);
}

export function money(value) {
  return Number(value).toFixed(2);
}

// Ledger status for a stored order: COMPLETED (seats unlocked), REFUNDED (a full PayPal refund
// revoked the seats), or AWAITING PAYMENT (created, maybe approved, not captured).
export function ledgerStatus(storedStatus) {
  if (storedStatus === 'COMPLETED') return 'COMPLETED';
  if (storedStatus === 'REFUNDED') return 'REFUNDED';
  return 'AWAITING PAYMENT';
}

// Seats still open in the class: the class size less the seats actually unlocked (captured).
// Orders awaiting payment hold no seat yet, so they are reported on their own (seatsReserved)
// and never subtracted here. A refunded order's seats leave seatsSold, so they come back.
export function seatsRemaining(classSize, seatsSold) {
  return Math.max(0, classSize - seatsSold);
}

const READINESS = { COMPLETED: 'Seat unlocked', REFUNDED: 'Seat revoked', 'AWAITING PAYMENT': 'Payment pending' };

// Builds the ledger from Supabase paypal_orders rows (already limited to one instructor).
export function dashboardFromOrders(rows) {
  const className = canonicalClassNames(rows.map((row) => row.student_name));
  const orders = rows.map((row) => {
    const payment = Array.isArray(row.paypal_payments) ? row.paypal_payments[0] : row.paypal_payments;
    const status = ledgerStatus(row.status);
    return {
      orderId: row.paypal_order_id,
      studentName: className(row.student_name),
      cohortId: COHORT.id,
      quantity: Number(row.quantity ?? 1),
      amount: money(row.amount),
      currency: row.currency,
      captureId: payment?.capture_id ?? '',
      status,
      createdAt: row.created_at,
      unlockedAt: status === 'COMPLETED' ? payment?.created_at : undefined,
    };
  });
  const seats = (status) => orders.filter((order) => order.status === status).reduce((sum, order) => sum + order.quantity, 0);
  const seatsSold = seats('COMPLETED');
  const seatsReserved = seats('AWAITING PAYMENT');
  const seatsRefunded = seats('REFUNDED');

  return {
    transactions: orders,
    quotas: [{
      id: COHORT.id,
      cohort: COHORT.name,
      classSize: COHORT.classSize,
      seatsSold,
      seatsReserved,
      seatsRefunded,
      seatsRemaining: seatsRemaining(COHORT.classSize, seatsSold),
    }],
    students: orders.map((order) => ({
      id: order.captureId || order.orderId,
      name: order.studentName,
      cohort: COHORT.name,
      readiness: READINESS[order.status],
    })),
  };
}
