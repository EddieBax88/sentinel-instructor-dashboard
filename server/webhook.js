import { Router } from 'express';
import { verifyCaptureForOrder, verifySandboxWebhook } from './paypal.js';
import { money } from './seatUnlock.js';
import { getPaypalOrder, getPaypalOrderByCaptureId, grantSeatAccess, recordWebhookEvent, revokeSeatAccess } from './supabase.js';

const router = Router();

const amountOf = (resource) => resource?.amount ?? resource?.purchase_units?.[0]?.amount;
const timestamp = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

// The capture a refund event refunds. PayPal's refund resource names it only through its HATEOAS
// "up" link (developer.paypal.com, Payments v2, Show refund details), e.g.
// https://api-m.sandbox.paypal.com/v2/payments/captures/{capture_id}.
export function captureIdOfRefund(event) {
  const links = Array.isArray(event?.resource?.links) ? event.resource.links : [];
  const up = links.find((link) => link?.rel === 'up' && typeof link.href === 'string');
  const match = up && /\/v2\/payments\/captures\/([^/?#]+)\/?(?:[?#]|$)/.exec(up.href);
  return match ? decodeURIComponent(match[1]) : null;
}

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
// response to PayPal or stop a seat grant. `resolved` carries the order and owner when the caller
// already looked them up (refunds name a capture, not an order).
async function recordEvent(event, resolved) {
  try {
    if (typeof event?.id !== 'string' || typeof event.event_type !== 'string') return;
    let { orderId = null, userId = null } = resolved ?? {};
    if (!resolved) {
      orderId = orderIdOfEvent(event);
      if (orderId) {
        try {
          userId = (await getPaypalOrder(orderId)).user_id;
        } catch {
          userId = null;
        }
      }
    }
    await recordWebhookEvent(webhookEventRow(event, { orderId, userId }));
  } catch (error) {
    console.warn(`PayPal event ${event?.id} was not recorded: ${error.message}`);
  }
}

// A verified PAYMENT.CAPTURE.REFUNDED event. Only a completed refund of the full captured amount
// revokes the seats; a partial refund, a refund of a capture this app never recorded, or a refund
// still pending is recorded for the drawer and changes nothing. Every one of those answers 200:
// a retry from PayPal could not change the outcome. Supabase failures answer 5xx so PayPal retries.
async function handleRefund(event) {
  const refund = event.resource || {};
  const captureId = captureIdOfRefund(event);
  const match = captureId ? await getPaypalOrderByCaptureId(captureId) : null;
  await recordEvent(event, { orderId: match?.order.paypal_order_id ?? null, userId: match?.order.user_id ?? null });

  const base = { received: true, revoked: false, refundId: typeof refund.id === 'string' ? refund.id : null };
  if (!captureId) return { ...base, reason: 'The refund event names no capture.' };
  if (!match) return { ...base, captureId, reason: 'No recorded seat capture matches this refund.' };

  const { order, payment } = match;
  const result = { ...base, captureId, orderId: order.paypal_order_id };
  if (refund.status !== 'COMPLETED') return { ...result, reason: `Refund status is ${refund.status ?? 'unknown'}, not COMPLETED.` };

  const refundAmount = refund.amount?.value;
  const full = refundAmount !== undefined && money(refundAmount) === money(payment.amount) && refund.amount?.currency_code === payment.currency;
  if (!full) return { ...result, partial: true, reason: 'Partial refund recorded; seats unchanged.' };
  if (order.status === 'REFUNDED' || payment.status === 'REFUNDED') return { ...result, alreadyRevoked: true };

  const outcome = await revokeSeatAccess({
    userId: order.user_id,
    orderId: order.paypal_order_id,
    captureId,
    refundId: refund.id,
    amount: money(payment.amount),
    currency: payment.currency,
  });
  return outcome === 'already_revoked' ? { ...result, alreadyRevoked: true } : { ...result, revoked: true };
}

router.post('/', async (request, response) => {
  try {
    const event = request.body;
    const verified = await verifySandboxWebhook(event, request.headers, request.rawBody);
    if (!verified) return response.status(400).json({ error: 'PayPal webhook signature is invalid.' });
    if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') return response.json(await handleRefund(event));
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