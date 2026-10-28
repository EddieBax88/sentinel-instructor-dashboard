import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { captureSandboxOrder, verifyCaptureForOrder } from './paypal.js';
import { SEAT_GRANT_FUNCTION } from './supabase.js';
import webhookRouter from './webhook.js';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const OTHER_INSTRUCTOR = '00000000-0000-4000-8000-00000000000b';
const originalFetch = globalThis.fetch;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_BASE_URL', 'PAYPAL_WEBHOOK_ID'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

let orders;
let grants;
let paypalCaptures;
let captureResult;

function pendingOrder(overrides = {}) {
  return {
    paypal_order_id: 'ORDER-30',
    user_id: INSTRUCTOR,
    student_name: 'Fall class',
    quantity: 30,
    amount: 1470,
    currency: 'USD',
    status: 'PENDING',
    paypal_payments: [],
    ...overrides,
  };
}

// Stands in for Supabase (paypal_orders reads and the grant function) and PayPal Sandbox.
// The fake grant mirrors the SQL function: a capture it already recorded is a no-op.
async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1') return originalFetch(url, options);
  if (hostname === 'example.supabase.co' && pathname === '/rest/v1/paypal_orders') {
    const id = searchParams.get('paypal_order_id')?.replace(/^eq\./, '');
    return Response.json(orders.filter((order) => order.paypal_order_id === id).map((order) => structuredClone(order)));
  }
  if (hostname === 'example.supabase.co' && pathname === `/rest/v1/rpc/${SEAT_GRANT_FUNCTION}`) {
    const body = JSON.parse(options.body);
    grants.push(body);
    const order = orders.find((row) => row.paypal_order_id === body.p_order_id);
    if (!order.paypal_payments.length) {
      order.paypal_payments = [{ capture_id: body.p_capture_id }];
      order.status = 'COMPLETED';
    }
    return new Response(null, { status: 204 });
  }
  if (hostname === 'api-m.sandbox.paypal.com' && pathname === '/v1/oauth2/token') {
    return Response.json({ access_token: 'sandbox-token', expires_in: 3600 });
  }
  if (hostname === 'api-m.sandbox.paypal.com' && pathname.endsWith('/capture')) {
    paypalCaptures.push({ pathname, requestId: options.headers['PayPal-Request-Id'] });
    return captureResult();
  }
  if (hostname === 'api-m.sandbox.paypal.com' && pathname === '/v1/notifications/verify-webhook-signature') {
    return Response.json({ verification_status: 'SUCCESS' });
  }
  throw new Error(`Unexpected request to ${url}`);
}

function completedCapture(value = '1470.00', id = 'CAPTURE-30') {
  return Response.json({
    id: 'ORDER-30',
    status: 'COMPLETED',
    purchase_units: [{ payments: { captures: [{ id, status: 'COMPLETED', amount: { value, currency_code: 'USD' } }] } }],
  });
}

test.beforeEach(() => {
  orders = [pendingOrder()];
  grants = [];
  paypalCaptures = [];
  captureResult = () => completedCapture();
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
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('captures an order that exists only in Supabase, with no server memory', async () => {
  // This module never created the order, as after a server restart.
  const { transaction, alreadyCaptured } = await captureSandboxOrder('ORDER-30', INSTRUCTOR);

  assert.equal(alreadyCaptured, false);
  assert.deepEqual(transaction, {
    orderId: 'ORDER-30', captureId: 'CAPTURE-30', studentName: 'Fall class', quantity: 30, amount: '1470.00', currency: 'USD', status: 'COMPLETED',
  });
  assert.deepEqual(paypalCaptures, [{ pathname: '/v2/checkout/orders/ORDER-30/capture', requestId: 'sentinel-capture-ORDER-30' }]);
  assert.deepEqual(grants, [{
    p_user_id: INSTRUCTOR, p_order_id: 'ORDER-30', p_capture_id: 'CAPTURE-30', p_status: 'COMPLETED', p_amount: '1470.00', p_currency: 'USD',
  }]);
  assert.equal(orders[0].status, 'COMPLETED');
});

test('a duplicate capture returns the stored result without calling PayPal or granting again', async () => {
  await captureSandboxOrder('ORDER-30', INSTRUCTOR);
  const repeat = await captureSandboxOrder('ORDER-30', INSTRUCTOR);

  assert.equal(repeat.alreadyCaptured, true);
  assert.equal(repeat.transaction.captureId, 'CAPTURE-30');
  assert.equal(paypalCaptures.length, 1);
  assert.equal(grants.length, 1);
});

test('only the instructor who owns the order can capture it', async () => {
  await assert.rejects(captureSandboxOrder('ORDER-30', OTHER_INSTRUCTOR), { statusCode: 403 });
  assert.equal(paypalCaptures.length, 0);
  assert.equal(grants.length, 0);
});

test('an unknown PayPal order returns 404', async () => {
  await assert.rejects(captureSandboxOrder('ORDER-MISSING', INSTRUCTOR), { statusCode: 404 });
  assert.equal(paypalCaptures.length, 0);
});

test('rejects a capture whose amount is not USD 49.00 x quantity', async () => {
  captureResult = () => completedCapture('49.00');
  await assert.rejects(captureSandboxOrder('ORDER-30', INSTRUCTOR), { statusCode: 409, message: /amount or currency/ });
  assert.equal(grants.length, 0);
  assert.equal(orders[0].status, 'PENDING');
});

test('refuses to capture a stored order whose amount does not match its quantity', async () => {
  orders = [pendingOrder({ amount: 49 })];
  await assert.rejects(captureSandboxOrder('ORDER-30', INSTRUCTOR), { statusCode: 409, message: /fixed seat price/ });
  assert.equal(paypalCaptures.length, 0);
  assert.equal(grants.length, 0);
});

test('if PayPal rejects a capture because another request already completed it, returns that result', async () => {
  captureResult = () => {
    orders[0].status = 'COMPLETED';
    orders[0].paypal_payments = [{ capture_id: 'CAPTURE-WEBHOOK' }];
    return Response.json({ name: 'UNPROCESSABLE_ENTITY', message: 'Order already captured.' }, { status: 422 });
  };
  const { alreadyCaptured, transaction } = await captureSandboxOrder('ORDER-30', INSTRUCTOR);
  assert.equal(alreadyCaptured, true);
  assert.equal(transaction.captureId, 'CAPTURE-WEBHOOK');
  assert.equal(grants.length, 0);
});

test('verifyCaptureForOrder requires a completed capture with an ID', () => {
  assert.throws(() => verifyCaptureForOrder(pendingOrder(), { captureId: 'C', status: 'PENDING', amount: '1470.00', currency: 'USD' }), { statusCode: 409 });
  assert.throws(() => verifyCaptureForOrder(pendingOrder(), { captureId: '', status: 'COMPLETED', amount: '1470.00', currency: 'USD' }), { statusCode: 409 });
  assert.throws(() => verifyCaptureForOrder(pendingOrder(), { captureId: 'C', status: 'COMPLETED', amount: '1470.00', currency: 'EUR' }), { statusCode: 409 });
  assert.deepEqual(
    verifyCaptureForOrder(pendingOrder(), { captureId: 'C', status: 'COMPLETED', amount: '1470.0', currency: 'USD' }),
    { captureId: 'C', status: 'COMPLETED', amount: '1470.00', currency: 'USD' },
  );
});

async function postWebhook(event) {
  const app = express();
  app.use(express.json({ verify: (request, _response, buffer) => { request.rawBody = Buffer.from(buffer); } }));
  app.use('/webhook', webhookRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert.pem',
        'paypal-transmission-id': 'transmission-1',
        'paypal-transmission-sig': 'signature',
        'paypal-transmission-time': '2026-10-28T18:00:00Z',
      },
      body: JSON.stringify(event),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const captureEvent = {
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {
    id: 'CAPTURE-30',
    status: 'COMPLETED',
    amount: { value: '1470.00', currency_code: 'USD' },
    supplementary_data: { related_ids: { order_id: 'ORDER-30' } },
  },
};

test('a verified webhook grants once from Supabase, and a later capture or repeat webhook does not grant again', async () => {
  const first = await postWebhook(captureEvent);
  assert.equal(first.status, 200);
  assert.equal(first.body.unlocked, true);
  assert.equal(grants.length, 1);

  const repeat = await postWebhook(captureEvent);
  assert.equal(repeat.body.alreadyCaptured, true);

  const capture = await captureSandboxOrder('ORDER-30', INSTRUCTOR);
  assert.equal(capture.alreadyCaptured, true);
  assert.equal(paypalCaptures.length, 0);
  assert.equal(grants.length, 1);
});

test('a webhook whose amount does not match the stored order is rejected without a grant', async () => {
  const result = await postWebhook({ ...captureEvent, resource: { ...captureEvent.resource, amount: { value: '49.00', currency_code: 'USD' } } });
  assert.equal(result.status, 409);
  assert.equal(grants.length, 0);
});
