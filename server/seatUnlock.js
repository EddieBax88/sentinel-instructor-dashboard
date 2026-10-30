import { DEFAULT_CLASS_SIZE } from './config.js';

export const COHORT = Object.freeze({
  id: 'sentinel-fall-2026',
  name: 'Sentinel Fall 2026',
  classSize: DEFAULT_CLASS_SIZE,
});

export function money(value) {
  return Number(value).toFixed(2);
}

// Builds the ledger from Supabase paypal_orders rows (already limited to one instructor).
export function dashboardFromOrders(rows) {
  const orders = rows.map((row) => {
    const payment = Array.isArray(row.paypal_payments) ? row.paypal_payments[0] : row.paypal_payments;
    const completed = row.status === 'COMPLETED';
    return {
      orderId: row.paypal_order_id,
      studentName: row.student_name,
      cohortId: COHORT.id,
      quantity: Number(row.quantity ?? 1),
      amount: money(row.amount),
      currency: row.currency,
      captureId: payment?.capture_id ?? '',
      status: completed ? 'COMPLETED' : 'AWAITING PAYMENT',
      createdAt: row.created_at,
      unlockedAt: payment?.created_at,
    };
  });
  const seats = (status) => orders.filter((order) => order.status === status).reduce((sum, order) => sum + order.quantity, 0);
  const seatsSold = seats('COMPLETED');
  const seatsReserved = seats('AWAITING PAYMENT');

  return {
    transactions: orders,
    quotas: [{
      id: COHORT.id,
      cohort: COHORT.name,
      classSize: COHORT.classSize,
      seatsSold,
      seatsReserved,
      seatsRemaining: Math.max(0, COHORT.classSize - seatsSold - seatsReserved),
    }],
    students: orders.map((order) => ({
      id: order.captureId || order.orderId,
      name: order.studentName,
      cohort: COHORT.name,
      readiness: order.status === 'COMPLETED' ? 'Seat unlocked' : 'Payment pending',
    })),
  };
}
