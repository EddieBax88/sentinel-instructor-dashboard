import { Router } from 'express';
import { verifyCaptureForOrder, verifySandboxWebhook } from './paypal.js';
import { getPaypalOrder, grantSentinelVoltAccess } from './supabase.js';

const router = Router();

router.post('/', async (request, response) => {
  try {
    const event = request.body;
    const verified = await verifySandboxWebhook(event, request.headers, request.rawBody);
    if (!verified) return response.status(400).json({ error: 'PayPal webhook signature is invalid.' });

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
      await grantSentinelVoltAccess({ userId: order.user_id, orderId, ...verifiedCapture });
      return response.json({ received: true, unlocked: true, transactionId: capture.captureId });
    }

    return response.json({ received: true, unlocked: false });
  } catch (error) {
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

export default router;