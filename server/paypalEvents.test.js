import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import app from './app.js';
import { SEAT_GRANT_FUNCTION } from './supabase.js';
import webhookRouter, { orderIdOfEvent, webhookEventRow } from './webhook.js';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const OTHER_INSTRUCTOR = '00000000-0000-4000-8000-00000000000b';
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_BASE_URL', 'PAYPAL_WEBHOOK_ID'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

let orders;
let grants;
let events;
let insertAttempts;
let insertBehaviour;
let verification;
let warnings;

// Stands in for Supabase (orders, the grant function, the events table, Auth) and PayPal's
// signature check. The events table mirrors the migration: event_id is the primary key and a
// repeated insert is ignored.
async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1') return originalFetch(url, options);
  if (hostname === 'example.supabase.co' && pathname === '/auth/v1/user') {
    const token = options.headers.Authorization;
    if (token === 'Bearer instructor-token') return Response.json({ id: INSTRUCTOR });
    if (token === 'Bearer other-token') return Response.json({ id: OTHER_INSTRUCTOR });
    return Response.json({ message: 'invalid' }, { status: 401 });
  }
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
  if (hostname === 'example.supabase.co' && pathname === '/rest/v1/paypal_webhook_events') {
    if ((options.method ?? 'GET') === 'POST') {
      insertAttempts.push({ query: searchParams.get('on_conflict'), prefer: options.headers.Prefer, row: JSON.parse(options.body) });
      if (insertBehaviour === 'fail') return Response.json({ message: 'table missing' }, { status: 500 });
      if (insertBehaviour === 'throw') throw new TypeError('fetch failed');
      const row = JSON.parse(options.body);
      if (!events.some((event) => event.event_id === row.event_id)) events.push({ ...row, received_at: `2026-11-01T18:00:0${events.length}Z` });
      return new Response(null, { status: 201 });
    }
    const userId = searchParams.get('user_id')?.replace(/^eq\./, '');
    return Response.json(events.filter((event) => event.user_id === userId).reverse());
  }
  if (hostname === 'api-m.sandbox.paypal.com' && pathname === '/v1/oauth2/token') {
    return Response.json({ access_token: 'sandbox-token', expires_in: 3600 });
  }
  if (hostname === 'api-m.sandbox.paypal.com' && pathname === '/v1/notifications/verify-webhook-signature') {
    return Response.json({ verification_status: verification });
  }
  throw new Error(`Unexpected request to ${url}`);
}

const pendingOrder = () => ({
  paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR, student_name: 'Fall class', quantity: 30,
  amount: 1470, currency: 'USD', status: 'PENDING', paypal_payments: [],
});

const captureEvent = {
  id: 'WH-CAPTURE-1',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource_type: 'capture',
  create_time: '2026-11-01T17:59:58Z',
  resource: {
    id: 'CAPTURE-30',
    status: 'COMPLETED',
    amount: { value: '1470.00', currency_code: 'USD' },
    supplementary_data: { related_ids: { order_id: 'ORDER-30' } },
  },
};

const approvedEvent = {
  id: 'WH-APPROVED-1',
  event_type: 'CHECKOUT.ORDER.APPROVED',
  resource_type: 'checkout-order',
  create_time: '2026-11-01T17:59:50Z',
  resource: {
    id: 'ORDER-30',
    status: 'APPROVED',
    purchase_units: [{ amount: { value: '1470.00', currency_code: 'USD' } }],
    payer: { name: { given_name: 'Pat', surname: 'Buyer' }, email_address: 'buyer@example.com', payer_id: 'PAYER-1' },
  },
};

test.beforeEach(() => {
  orders = [pendingOrder()];
  grants = [];
  events = [];
  insertAttempts = [];
  insertBehaviour = 'ok';
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
        'paypal-transmission-time': '2026-11-01T18:00:00Z',
      },
      body: JSON.stringify(event),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
}

async function getEvents(token) {
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${listener.address().port}/api/paypal/events`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
}

test('a verified capture event is recorded once with its owner, and a PayPal retry adds no second row', async () => {
  const first = await postWebhook(captureEvent);
  assert.deepEqual([first.status, first.body.unlocked], [200, true]);
  const retry = await postWebhook(captureEvent);
  assert.deepEqual([retry.status, retry.body.alreadyCaptured], [200, true]);

  assert.equal(grants.length, 1);
  assert.equal(insertAttempts.length, 2);
  assert.ok(insertAttempts.every(({ query, prefer }) => query === 'event_id' && prefer.includes('resolution=ignore-duplicates')));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    event_id: 'WH-CAPTURE-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource_type: 'capture',
    resource_id: 'CAPTURE-30', resource_status: 'COMPLETED', paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR,
    amount: 1470, currency: 'USD', event_created_at: '2026-11-01T17:59:58Z', received_at: '2026-11-01T18:00:00Z',
  });
});

test('an order event is recorded against its order and owner, without payer details', async () => {
  const result = await postWebhook(approvedEvent);
  assert.deepEqual(result, { status: 200, body: { received: true, unlocked: false } });
  assert.equal(grants.length, 0);
  assert.equal(events[0].paypal_order_id, 'ORDER-30');
  assert.equal(events[0].user_id, INSTRUCTOR);
  assert.equal(events[0].resource_status, 'APPROVED');
  assert.equal(events[0].amount, 1470);
  assert.doesNotMatch(JSON.stringify(events[0]), /buyer@example\.com|Pat|PAYER-1/);
});

test('an event for an order not in Supabase is stored with no owner, so no instructor sees it', async () => {
  const result = await postWebhook({ ...approvedEvent, id: 'WH-UNKNOWN', resource: { ...approvedEvent.resource, id: 'ORDER-UNKNOWN' } });
  assert.equal(result.status, 200);
  assert.equal(events[0].user_id, null);
  assert.deepEqual((await getEvents('instructor-token')).body.events, []);
});

for (const [behaviour, label] of [['fail', 'Supabase rejects the write'], ['throw', 'the write cannot reach Supabase']]) {
  test(`when ${label}, the response to PayPal and the seat grant are unchanged`, async () => {
    insertBehaviour = behaviour;
    const result = await postWebhook(captureEvent);
    assert.deepEqual(result, { status: 200, body: { received: true, unlocked: true, transactionId: 'CAPTURE-30' } });
    assert.equal(grants.length, 1);
    assert.equal(events.length, 0);
    assert.equal(insertAttempts.length, 1);
    assert.match(warnings.join('\n'), /PayPal event WH-CAPTURE-1 was not recorded/);
  });
}

test('an event that fails signature verification is neither recorded nor acted on', async () => {
  verification = 'FAILURE';
  const result = await postWebhook(captureEvent);
  assert.equal(result.status, 400);
  assert.equal(insertAttempts.length, 0);
  assert.equal(grants.length, 0);
});

test('GET /api/paypal/events requires sign-in and returns only that instructor\'s events, newest first', async () => {
  orders.push({ ...pendingOrder(), paypal_order_id: 'ORDER-OTHER', user_id: OTHER_INSTRUCTOR });
  await postWebhook(approvedEvent);
  await postWebhook(captureEvent);
  await postWebhook({ ...approvedEvent, id: 'WH-OTHER', resource: { ...approvedEvent.resource, id: 'ORDER-OTHER' } });

  assert.equal((await getEvents(null)).status, 401);
  assert.equal((await getEvents('bad-token')).status, 401);

  const mine = await getEvents('instructor-token');
  assert.equal(mine.status, 200);
  assert.equal(mine.cache, 'no-store');
  assert.deepEqual(mine.body.events.map((event) => event.eventId), ['WH-CAPTURE-1', 'WH-APPROVED-1']);
  assert.deepEqual(mine.body.events[0], {
    eventId: 'WH-CAPTURE-1', eventType: 'PAYMENT.CAPTURE.COMPLETED', resourceType: 'capture', resourceId: 'CAPTURE-30',
    status: 'COMPLETED', orderId: 'ORDER-30', amount: 1470, currency: 'USD',
    createdAt: '2026-11-01T17:59:58Z', receivedAt: '2026-11-01T18:00:01Z',
  });

  const theirs = await getEvents('other-token');
  assert.deepEqual(theirs.body.events.map((event) => event.eventId), ['WH-OTHER']);
});

test('orderIdOfEvent and webhookEventRow handle events with missing fields', () => {
  assert.equal(orderIdOfEvent({ resource_type: 'refund', resource: { id: 'REFUND-1' } }), null);
  assert.equal(orderIdOfEvent({}), null);
  const row = webhookEventRow({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', create_time: 'not a date', resource: { amount: { value: 'x' } } }, { orderId: null, userId: null });
  assert.deepEqual([row.amount, row.event_created_at, row.resource_id, row.resource_type], [null, null, null, null]);
});
