import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import analyticsRouter, { analyticsFromOrders } from './analytics.js';
import { DEFAULT_CLASS_SIZE } from './config.js';

const INSTRUCTOR_A = '00000000-0000-4000-8000-00000000000a';
const INSTRUCTOR_B = '00000000-0000-4000-8000-00000000000b';
const TOKENS = { 'token-a': INSTRUCTOR_A, 'token-b': INSTRUCTOR_B };
const originalFetch = globalThis.fetch;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

const storedOrders = [
  {
    paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR_A, student_name: 'Fall class', quantity: 30, amount: 1470, currency: 'USD',
    status: 'PENDING', created_at: '2026-10-28T18:00:00Z', paypal_payments: [],
  },
  {
    paypal_order_id: 'ORDER-2', user_id: INSTRUCTOR_A, student_name: 'Spring class', quantity: 2, amount: '98.00', currency: 'USD',
    status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-2', created_at: '2026-10-27T18:05:00Z' }],
  },
  {
    paypal_order_id: 'ORDER-B', user_id: INSTRUCTOR_B, student_name: 'Other class', quantity: 5, amount: 245, currency: 'USD',
    status: 'COMPLETED', created_at: '2026-10-26T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-B', created_at: '2026-10-26T18:05:00Z' }],
  },
];

let orderQueries;
let failOrdersRead;

// Stands in for Supabase Auth (token -> user) and the paypal_orders REST read (filtered by user_id).
async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1') return originalFetch(url, options);
  if (hostname === 'example.supabase.co' && pathname === '/auth/v1/user') {
    const token = options.headers.Authorization.replace(/^Bearer /, '');
    return TOKENS[token] ? Response.json({ id: TOKENS[token], email: 'instructor@example.test' }) : Response.json({ message: 'invalid' }, { status: 401 });
  }
  if (hostname === 'example.supabase.co' && pathname === '/rest/v1/paypal_orders') {
    const userFilter = searchParams.get('user_id');
    orderQueries.push({ userFilter, apikey: options.headers.apikey });
    if (failOrdersRead) return Response.json({ message: 'boom' }, { status: 500 });
    return Response.json(storedOrders.filter((row) => `eq.${row.user_id}` === userFilter));
  }
  throw new Error(`Unexpected request to ${url}`);
}

async function getAnalytics({ token, query = '' } = {}) {
  const app = express();
  app.use('/api/analytics', analyticsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/analytics/orders${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test.beforeEach(() => {
  orderQueries = [];
  failOrdersRead = false;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  globalThis.fetch = fakeFetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('requires sign-in: no token or an invalid token gets 401 and reads no orders', async () => {
  const missing = await getAnalytics();
  assert.equal(missing.status, 401);
  assert.match(missing.body.error, /access token is required/);

  const invalid = await getAnalytics({ token: 'forged-token' });
  assert.equal(invalid.status, 401);
  assert.match(invalid.body.error, /invalid or expired/);

  assert.equal(orderQueries.length, 0);
});

test("returns only the signed-in instructor's orders, shaped for AG Studio", async () => {
  const { status, cache, body } = await getAnalytics({ token: 'token-a' });

  assert.equal(status, 200);
  assert.equal(cache, 'no-store');
  assert.deepEqual(orderQueries, [{ userFilter: `eq.${INSTRUCTOR_A}`, apikey: 'test-service-role-key' }]);
  assert.equal(body.classSize, DEFAULT_CLASS_SIZE);
  assert.deepEqual(body.orders.map((order) => order.orderId), ['ORDER-30', 'ORDER-2']);
  assert.deepEqual(body.orders[0], {
    orderId: 'ORDER-30', className: 'Fall class', status: 'Pending', currency: 'USD',
    seats: 30, seatsUnlocked: 0, seatsPending: 30, amount: 1470, revenue: 0, pendingAmount: 1470,
    orderDate: '2026-10-28', capturedDate: null,
  });
  assert.deepEqual(body.orders[1], {
    orderId: 'ORDER-2', className: 'Spring class', status: 'Unlocked', currency: 'USD',
    seats: 2, seatsUnlocked: 2, seatsPending: 0, amount: 98, revenue: 98, pendingAmount: 0,
    orderDate: '2026-10-27', capturedDate: '2026-10-27',
  });
});

test('ignores a user id supplied in the request and keeps each instructor to their own orders', async () => {
  const spoofed = await getAnalytics({ token: 'token-a', query: `?user_id=${INSTRUCTOR_B}&userId=${INSTRUCTOR_B}` });
  assert.deepEqual(spoofed.body.orders.map((order) => order.orderId), ['ORDER-30', 'ORDER-2']);

  const other = await getAnalytics({ token: 'token-b' });
  assert.deepEqual(other.body.orders.map((order) => order.orderId), ['ORDER-B']);
  assert.deepEqual(orderQueries.map((query) => query.userFilter), [`eq.${INSTRUCTOR_A}`, `eq.${INSTRUCTOR_B}`]);
});

test('reports a Supabase read failure as 502 without returning data', async () => {
  failOrdersRead = true;
  const { status, body } = await getAnalytics({ token: 'token-a' });
  assert.equal(status, 502);
  assert.equal(body.orders, undefined);
});

test('an instructor with no orders gets an empty list and the default class size', () => {
  assert.deepEqual(analyticsFromOrders([]), { classSize: DEFAULT_CLASS_SIZE, orders: [] });
});
