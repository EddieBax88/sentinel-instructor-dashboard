import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxOrder, verifySandboxWebhook } from './paypal.js';

test('rejects a live PayPal host before making any outbound request', async () => {
  const previousEnvironment = {
    clientId: process.env.PAYPAL_CLIENT_ID,
    secret: process.env.PAYPAL_SECRET,
    baseUrl: process.env.PAYPAL_BASE_URL,
  };
  const originalFetch = globalThis.fetch;
  process.env.PAYPAL_CLIENT_ID = 'sandbox_test_client';
  process.env.PAYPAL_SECRET = 'sandbox_test_secret';
  process.env.PAYPAL_BASE_URL = 'https://api-m.paypal.com';
  globalThis.fetch = async () => { throw new Error('Unexpected outbound request'); };

  try {
    await assert.rejects(createSandboxOrder({
      studentName: 'Demo Student',
      userId: '00000000-0000-4000-8000-000000000001',
    }), /Live PayPal endpoints are disabled/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnvironment.clientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousEnvironment.clientId;
    if (previousEnvironment.secret === undefined) delete process.env.PAYPAL_SECRET;
    else process.env.PAYPAL_SECRET = previousEnvironment.secret;
    if (previousEnvironment.baseUrl === undefined) delete process.env.PAYPAL_BASE_URL;
    else process.env.PAYPAL_BASE_URL = previousEnvironment.baseUrl;
  }
});

test('requires the raw PayPal webhook body and verifies it with the configured webhook id', async () => {
  const previousEnvironment = {
    clientId: process.env.PAYPAL_CLIENT_ID,
    secret: process.env.PAYPAL_SECRET,
    baseUrl: process.env.PAYPAL_BASE_URL,
    webhookId: process.env.PAYPAL_WEBHOOK_ID,
  };
  const originalFetch = globalThis.fetch;
  process.env.PAYPAL_CLIENT_ID = 'sandbox_test_client';
  process.env.PAYPAL_SECRET = 'sandbox_test_secret';
  process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
  process.env.PAYPAL_WEBHOOK_ID = 'sandbox-webhook-id';
  const rawBody = Buffer.from('{"event_type":"PAYMENT.CAPTURE.COMPLETED"}');
  let fetchCount = 0;
  globalThis.fetch = async (url, options) => {
    fetchCount += 1;
    if (url.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'sandbox-access-token', expires_in: 300 });
    }

    assert.equal(url, 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.webhook_id, 'sandbox-webhook-id');
    assert.equal(options.body.endsWith(`,"webhook_event":${rawBody.toString()}}`), true);
    return Response.json({ verification_status: 'SUCCESS' });
  };

  try {
    assert.equal(await verifySandboxWebhook({}, {}, undefined), false);
    assert.equal(fetchCount, 0);
    assert.equal(await verifySandboxWebhook(
      { event_type: 'PAYMENT.CAPTURE.COMPLETED' },
      {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert',
        'paypal-transmission-id': 'transmission-id',
        'paypal-transmission-sig': 'signature',
        'paypal-transmission-time': '2026-10-27T00:00:00Z',
      },
      rawBody,
    ), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnvironment.clientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousEnvironment.clientId;
    if (previousEnvironment.secret === undefined) delete process.env.PAYPAL_SECRET;
    else process.env.PAYPAL_SECRET = previousEnvironment.secret;
    if (previousEnvironment.baseUrl === undefined) delete process.env.PAYPAL_BASE_URL;
    else process.env.PAYPAL_BASE_URL = previousEnvironment.baseUrl;
    if (previousEnvironment.webhookId === undefined) delete process.env.PAYPAL_WEBHOOK_ID;
    else process.env.PAYPAL_WEBHOOK_ID = previousEnvironment.webhookId;
  }
});