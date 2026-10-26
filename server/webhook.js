import { Router } from 'express';
import { verifySandboxWebhook } from './paypal.js';
import { unlockSeatsFromVerifiedCapture } from './seatUnlock.js';

const router = Router();

router.post('/', async (request, response) => {
  try {
    const event = request.body;
    const verified = await verifySandboxWebhook(event, request.headers, request.rawBody);
    if (!verified) return response.status(400).json({ error: 'PayPal webhook signature is invalid.' });

    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = event.resource || {};
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      const transaction = unlockSeatsFromVerifiedCapture({
        orderId,
        captureId: resource.id,
        status: resource.status,
        amount: resource.amount?.value,
        currency: resource.amount?.currency_code,
        source: 'verified-webhook',
      });
      return response.json({ received: true, unlocked: true, transactionId: transaction.captureId });
    }

    return response.json({ received: true, unlocked: false });
  } catch (error) {
    return response.status(error.statusCode || 400).json({ error: error.message });
  }
});

export default router;