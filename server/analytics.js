import { Router } from 'express';
import { DEFAULT_CLASS_SIZE } from './config.js';
import { canonicalClassNames } from './seatUnlock.js';
import { authenticateSupabaseUser, getBearerToken, listPaypalOrdersForUser } from './supabase.js';

const money = (value) => Math.round(Number(value) * 100) / 100;
const dateOnly = (timestamp) => (typeof timestamp === 'string' && timestamp ? timestamp.slice(0, 10) : null);

const STATUS_LABELS = { COMPLETED: 'Unlocked', REFUNDED: 'Refunded' };

// One row per seat order, shaped for AG Studio: plain numbers and ISO dates, with seats and money
// already split by status (Unlocked, Pending, Refunded) so widgets can simply sum them. Rows must
// already be limited to one instructor (listPaypalOrdersForUser does that on the server).
export function analyticsFromOrders(rows) {
  // One spelling per class, so Studio's by-class grouping never splits "fall class" from "Fall class".
  const className = canonicalClassNames(rows.map((row) => row.student_name));
  const orders = rows.map((row) => {
    const payment = Array.isArray(row.paypal_payments) ? row.paypal_payments[0] : row.paypal_payments;
    const status = STATUS_LABELS[row.status] ?? 'Pending';
    const unlocked = status === 'Unlocked';
    const refunded = status === 'Refunded';
    const pending = !unlocked && !refunded;
    const seats = Number(row.quantity ?? 1);
    const amount = money(row.amount);
    return {
      orderId: row.paypal_order_id,
      className: className(row.student_name),
      status,
      currency: row.currency,
      seats,
      seatsUnlocked: unlocked ? seats : 0,
      seatsPending: pending ? seats : 0,
      seatsRefunded: refunded ? seats : 0,
      amount,
      revenue: unlocked ? amount : 0,
      pendingAmount: pending ? amount : 0,
      refundedAmount: refunded ? amount : 0,
      orderDate: dateOnly(row.created_at),
      capturedDate: unlocked || refunded ? dateOnly(payment?.created_at) : null,
    };
  });
  return { classSize: DEFAULT_CLASS_SIZE, orders };
}

const router = Router();

// GET /api/analytics/orders - sign-in only. The user ID comes from the verified access token, never
// from the request, and the Supabase read filters on it with the secret key on the server.
router.get('/orders', async (request, response) => {
  try {
    const user = await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
    response.set('Cache-Control', 'no-store');
    response.json(analyticsFromOrders(await listPaypalOrdersForUser(user.id)));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

export default router;
