import { Router } from 'express';
import { verifyCaptureForOrder, verifySandboxWebhook } from './paypal.js';
import { getPaypalOrder, grantSeatAccess, recordWebhookEvent } from './supabase.js';

const router = Router();

const amountOf = (resource) => resource?.amount ?? resource?.purchase_units?.[0]?.amount;
const timestamp = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

// The seat order a verified event is about: captures and refunds name it in related_ids; order
// events are the order itself.
export function orderIdOfEvent(event) {
  const resource = event?.resource ?? {};
  const related = resource.supplementary_data?.related_ids?.order_id;
  if (related) return related;
  return event?.resource_type === 'checkout-order' && typeof resource.id === 'string' ? resource.id : null;
}

// The stored row for a verified event: only what the event drawer shows, no payer details.
export function webhookEventRow(event, { orderId, userId }) {
  const resource = event.resource ?? {};
  const amount = Number(amountOf(resource)?.value);
  return {
    event_id: event.id,
    event_type: event.event_type,
    resource_type: event.resource_type ?? null,
    resource_id: typeof resource.id === 'string' ? resource.id : null,
    resource_status: typeof resource.status === 'string' ? resource.status : null,
    paypal_order_id: orderId,
    user_id: userId,
    amount: Number.isFinite(amount) ? amount : null,
    currency: amountOf(resource)?.currency_code ?? null,
    event_created_at: timestamp(event.create_time),
  };
}

// What GET /api/paypal/events returns for one stored row.
export function publicWebhookEvent(row) {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    status: row.resource_status,
    orderId: row.paypal_order_id,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    currency: row.currency,
    createdAt: row.event_created_at,
    receivedAt: row.received_at,
  };
}

// Records a verified event for the drawer. Never throws: a failure here must not change the
// response to PayPal or stop a seat grant.
async function recordEvent(event) {
  try {
    if (typeof event?.id !== 'string' || typeof event.event_type !== 'string') return;
    const orderId = orderIdOfEvent(event);
    let userId = null;
    if (orderId) {
      try {
        userId = (await getPaypalOrder(orderId)).user_id;
      } catch {
        userId = null;
      }
    }
    await recordWebhookEvent(webhookEventRow(event, { orderId, userId }));
  } catch (error) {
    console.warn(`PayPal event ${event?.id} was not recorded: ${error.message}`);
  }
}

router.post('/', async (request, response) => {
  try {
    const event = request.body;
    const verified = await verifySandboxWebhook(event, request.headers, request.rawBody);
    if (!verified) return response.status(400).json({ error: 'PayPal webhook signature is invalid.' });
    await recordEvent(event);

    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = event.resource || {};
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      const capture = {
        orderId,
        captureId: resource.id,
        status: resource.status,
        amount: resource.amount?.value,
        currency: resource.amount?.currency_code,
      };
      if (!orderId || !capture.captureId || capture.status !== 'COMPLETED') {
        return response.status(400).json({ error: 'The verified PayPal event is missing a completed capture or order ID.' });
      }

      const order = await getPaypalOrder(orderId);
      if (order.status === 'COMPLETED') {
        return response.json({ received: true, unlocked: false, alreadyCaptured: true, transactionId: capture.captureId });
      }
      const verifiedCapture = verifyCaptureForOrder(order, capture);
      await grantSeatAccess({ userId: order.user_id, orderId, ...verifiedCapture });
      return response.json({ received: true, unlocked: true, transactionId: capture.captureId });
    }

    return response.json({ received: true, unlocked: false });
  } catch (error) {
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

export default router;