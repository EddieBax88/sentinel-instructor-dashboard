import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { SEAT_GRANT_FUNCTION, SEAT_REVOKE_FUNCTION } from './supabase.js';
import webhookRouter, { captureIdOfRefund } from './webhook.js';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_BASE_URL', 'PAYPAL_WEBHOOK_ID'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

let orders;
let payments;
let entitlements;
let revokes;
let grants;
let events;
let revokeBehaviour;
let verification;
let warnings;

// Stands in for Supabase (orders, payments with the order embedded, the grant and revoke
// functions, the events table) and PayPal's signature check. The fake revoke mirrors the SQL
// function: a payment already REFUNDED answers 'already_revoked', and the entitlement is
// deactivated only when no COMPLETED order remains for the instructor.
async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1') return originalFetch(url, options);
  if (hostname === 'example.supabase.co' && pathname === '/rest/v1/paypal_orders') {
    const id = searchParams.get('paypal_order_id')?.replace(/^eq\./, '');
    return Response.json(orders.filter((order) => order.paypal_order_id === id).map((order) => ({ ...order, paypal_payments: payments.filter((p) => p.paypal_order_id === id) })));
  }
  if (hostname === 'example.supabase.co' && pathname === '/rest/v1/paypal_payments') {
    const id = searchParams.get('capture_id')?.replace(/^eq\./, '');
    assert.match(searchParams.get('select'), /paypal_orders\(/);
    return Response.json(payments.filter((p) => p.capture_id === id).map((p) => ({ ...p, paypal_orders: orders.find((o) => o.paypal_order_id === p.paypal_order_id) ?? null })));
  }
  if (hostname === 'example.supabase.co' && pathname === `/rest/v1/rpc/${SEAT_REVOKE_FUNCTION}`) {
    const body = JSON.parse(options.body);
    revokes.push(body);
    if (revokeBehaviour === 'fail') return Response.json({ message: 'function missing' }, { status: 404 });
    const payment = payments.find((p) => p.capture_id === body.p_capture_id);
    if (payment.status === 'REFUNDED') return Response.json('already_revoked');
    payment.status = 'REFUNDED';
    payment.refund_id = body.p_refund_id;
    orders.find((o) => o.paypal_order_id === body.p_order_id).status = 'REFUNDED';
    if (!orders.some((o) => o.user_id === body.p_user_id && o.status === 'COMPLETED')) entitlements[body.p_user_id] = false;
    return Response.json('revoked');
  }
  if (hostname === 'example.supabase.co' && pathname === `/rest/v1/rpc/${SEAT_GRANT_FUNCTION}`) {
    grants.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  }
  if (hostname === 'example.supabase.co' && pathname === '/rest/v1/paypal_webhook_events') {
    const row = JSON.parse(options.body);
    if (!events.some((event) => event.event_id === row.event_id)) events.push(row);
    return new Response(null, { status: 201 });
  }
  if (hostname === 'api-m.sandbox.paypal.com' && pathname === '/v1/oauth2/token') {
    return Response.json({ access_token: 'sandbox-token', expires_in: 3600 });
  }
  if (hostname === 'api-m.sandbox.paypal.com' && pathname === '/v1/notifications/verify-webhook-signature') {
    return Response.json({ verification_status: verification });
  }
  throw new Error(`Unexpected request to ${url}`);
}

const upLink = (captureId) => ({ rel: 'up', method: 'GET', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` });

// Shaped like PayPal's refund resource (Payments v2, Show refund details): the capture is named
// only by the "up" link.
function refundEvent({ id = 'WH-REFUND-1', refundId = 'REFUND-1', captureId = 'CAPTURE-30', value = '1470.00', currency = 'USD', status = 'COMPLETED', links } = {}) {
  return {
    id,
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource_type: 'refund',
    create_time: '2026-11-02T10:00:00Z',
    resource: {
      id: refundId,
      status,
      amount: { value, currency_code: currency },
      seller_payable_breakdown: { gross_amount: { value, currency_code: currency }, total_refunded_amount: { value, currency_code: currency } },
      links: links ?? [{ rel: 'self', method: 'GET', href: `https://api-m.sandbox.paypal.com/v2/payments/refunds/${refundId}` }, upLink(captureId)],
    },
  };
}

test.beforeEach(() => {
  orders = [
    { paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR, student_name: 'Fall class', quantity: 30, amount: 1470, currency: 'USD', status: 'COMPLETED' },
    { paypal_order_id: 'ORDER-2', user_id: INSTRUCTOR, student_name: 'Spring class', quantity: 2, amount: 98, currency: 'USD', status: 'COMPLETED' },
  ];
  payments = [
    { capture_id: 'CAPTURE-30', paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR, amount: 1470, currency: 'USD', status: 'COMPLETED' },
    { capture_id: 'CAPTURE-2', paypal_order_id: 'ORDER-2', user_id: INSTRUCTOR, amount: 98, currency: 'USD', status: 'COMPLETED' },
  ];
  entitlements = { [INSTRUCTOR]: true };
  revokes = [];
  grants = [];
  events = [];
  revokeBehaviour = 'ok';
  verification = 'SUCCESS';
  warnings = [];
  console.warn = (message) => warnings.push(message);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.PAYPAL_CLIENT_ID = 'sandbox_test_client';
  process.env.PAYPAL_SECRET = 'sandbox_test_secret';
  process.env.PAYPAL_WEBHOOK_ID = 'sandbox_webhook_id';
  delete process.env.PAYPAL_BASE_URL;
  globalThis.fetch = fakeFetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function postWebhook(event) {
  const server = express();
  server.use(express.json({ verify: (request, _response, buffer) => { request.rawBody = Buffer.from(buffer); } }));
  server.use('/webhook', webhookRouter);
  const listener = server.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${listener.address().port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert.pem',
        'paypal-transmission-id': 'transmission-1',
        'paypal-transmission-sig': 'signature',
        'paypal-transmission-time': '2026-11-02T10:00:01Z',
      },
      body: JSON.stringify(event),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
}

test('a verified full refund revokes the seats through the revoke function, once, and is recorded for the drawer', async () => {
  const first = await postWebhook(refundEvent());
  assert.deepEqual(first, { status: 200, body: { received: true, revoked: true, refundId: 'REFUND-1', captureId: 'CAPTURE-30', orderId: 'ORDER-30' } });
  assert.deepEqual(revokes, [{
    p_user_id: INSTRUCTOR, p_order_id: 'ORDER-30', p_capture_id: 'CAPTURE-30', p_refund_id: 'REFUND-1', p_amount: '1470.00', p_currency: 'USD',
  }]);
  assert.equal(orders[0].status, 'REFUNDED');
  assert.equal(payments[0].status, 'REFUNDED');
  assert.equal(entitlements[INSTRUCTOR], true, 'another completed order remains, so access stays active');

  // PayPal retries the same event: the stored order is already REFUNDED, so nothing is called again.
  const retry = await postWebhook(refundEvent());
  assert.deepEqual([retry.status, retry.body.revoked, retry.body.alreadyRevoked], [200, false, true]);
  assert.equal(revokes.length, 1);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    event_id: 'WH-REFUND-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource_type: 'refund', resource_id: 'REFUND-1',
    resource_status: 'COMPLETED', paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR, amount: 1470, currency: 'USD', event_created_at: '2026-11-02T10:00:00Z',
  });
  assert.equal(grants.length, 0);
});

test('refunding the last completed order deactivates the instructor\'s seat access', async () => {
  await postWebhook(refundEvent());
  assert.equal(entitlements[INSTRUCTOR], true);
  await postWebhook(refundEvent({ id: 'WH-REFUND-2', refundId: 'REFUND-2', captureId: 'CAPTURE-2', value: '98.00' }));
  assert.equal(entitlements[INSTRUCTOR], false);
  assert.deepEqual(orders.map((order) => order.status), ['REFUNDED', 'REFUNDED']);
});

test('a partial refund is recorded and changes nothing', async () => {
  const result = await postWebhook(refundEvent({ value: '49.00' }));
  assert.deepEqual([result.status, result.body.revoked, result.body.partial], [200, false, true]);
  assert.equal(revokes.length, 0);
  assert.equal(orders[0].status, 'COMPLETED');
  assert.equal(events[0].paypal_order_id, 'ORDER-30');
  assert.equal(events[0].amount, 49);
});

test('a refund in another currency or with no amount is not treated as full', async () => {
  const currency = await postWebhook(refundEvent({ currency: 'EUR' }));
  assert.equal(currency.body.partial, true);
  const missing = refundEvent({ id: 'WH-REFUND-3' });
  delete missing.resource.amount;
  const noAmount = await postWebhook(missing);
  assert.equal(noAmount.body.partial, true);
  assert.equal(revokes.length, 0);
});

test('a refund that is not COMPLETED is recorded and changes nothing', async () => {
  const result = await postWebhook(refundEvent({ status: 'PENDING' }));
  assert.deepEqual([result.status, result.body.revoked], [200, false]);
  assert.match(result.body.reason, /PENDING/);
  assert.equal(revokes.length, 0);
  assert.equal(events[0].resource_status, 'PENDING');
});

test('a refund for a capture this app never recorded is recorded without an owner and ignored', async () => {
  const result = await postWebhook(refundEvent({ captureId: 'CAPTURE-ELSEWHERE' }));
  assert.deepEqual([result.status, result.body.revoked, result.body.captureId], [200, false, 'CAPTURE-ELSEWHERE']);
  assert.equal(revokes.length, 0);
  assert.deepEqual([events[0].paypal_order_id, events[0].user_id], [null, null]);
});

test('a refund event with no capture link is recorded and ignored', async () => {
  const result = await postWebhook(refundEvent({ links: [{ rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/payments/refunds/REFUND-1' }] }));
  assert.deepEqual([result.status, result.body.revoked], [200, false]);
  assert.match(result.body.reason, /names no capture/);
  assert.equal(revokes.length, 0);
  assert.equal(events.length, 1);
});

test('a refund that fails signature verification is neither recorded nor acted on', async () => {
  verification = 'FAILURE';
  const result = await postWebhook(refundEvent());
  assert.equal(result.status, 400);
  assert.equal(events.length, 0);
  assert.equal(revokes.length, 0);
});

test('when Supabase cannot run the revoke, the response is 5xx so PayPal retries', async () => {
  revokeBehaviour = 'fail';
  const result = await postWebhook(refundEvent());
  assert.equal(result.status, 502);
  assert.equal(orders[0].status, 'COMPLETED');
});

test('captureIdOfRefund reads the capture from the refund\'s "up" link only', () => {
  assert.equal(captureIdOfRefund(refundEvent()), 'CAPTURE-30');
  assert.equal(captureIdOfRefund(refundEvent({ links: [upLink('CAP-1'), { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-2' }] })), 'CAP-1');
  assert.equal(captureIdOfRefund(refundEvent({ links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-30' }] })), null);
  assert.equal(captureIdOfRefund({ resource: { links: 'none' } }), null);
  assert.equal(captureIdOfRefund(undefined), null);
});
