// The Confirm gate for agent-proposed refunds: POST /api/paypal/captures/:captureId/refund, against
// fakes for Supabase (payments with the order embedded, the revoke function, agent_actions) and
// PayPal Sandbox (token and the Captures Refund API).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEAT_REVOKE_FUNCTION } from './supabase.js';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const OTHER_INSTRUCTOR = '00000000-0000-4000-8000-00000000000b';
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_BASE_URL', 'NVIDIA_API_KEY'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

let orders;
let payments;
let revokes;
let actions;
let refundRequests;
let paypalRefund;
let authCalls;

async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1') return originalFetch(url, options);
  if (hostname === 'example.supabase.co') {
    if (pathname === '/auth/v1/user') {
      authCalls.push(options.headers.Authorization);
      if (options.headers.Authorization === 'Bearer instructor-token') return Response.json({ id: INSTRUCTOR });
      if (options.headers.Authorization === 'Bearer other-token') return Response.json({ id: OTHER_INSTRUCTOR });
      return Response.json({ message: 'invalid' }, { status: 401 });
    }
    if (pathname === '/rest/v1/paypal_payments') {
      const id = searchParams.get('capture_id')?.replace(/^eq\./, '');
      return Response.json(payments.filter((p) => p.capture_id === id).map((p) => ({ ...p, paypal_orders: orders.find((o) => o.paypal_order_id === p.paypal_order_id) ?? null })));
    }
    if (pathname === `/rest/v1/rpc/${SEAT_REVOKE_FUNCTION}`) {
      const body = JSON.parse(options.body);
      revokes.push(body);
      const payment = payments.find((p) => p.capture_id === body.p_capture_id);
      if (payment.status === 'REFUNDED') return Response.json('already_revoked');
      payment.status = 'REFUNDED';
      orders.find((o) => o.paypal_order_id === body.p_order_id).status = 'REFUNDED';
      return Response.json('revoked');
    }
    if (pathname === '/rest/v1/agent_actions') {
      actions.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
  }
  if (hostname === 'api-m.sandbox.paypal.com') {
    if (pathname === '/v1/oauth2/token') return Response.json({ access_token: 'sandbox-token', expires_in: 3600 });
    const match = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(pathname);
    if (match && options.method === 'POST') {
      refundRequests.push({ captureId: match[1], headers: options.headers, body: JSON.parse(options.body) });
      return paypalRefund(match[1]);
    }
  }
  throw new Error(`Unexpected request to ${url}`);
}

async function serve(fn) {
  const { default: app } = await import('./app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const refund = (base, captureId, token = 'instructor-token') => fetch(`${base}/api/paypal/captures/${captureId}/refund`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

test.beforeEach(() => {
  Object.assign(process.env, { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key', PAYPAL_CLIENT_ID: 'sandbox_test_client', PAYPAL_SECRET: 'sandbox_test_secret', NVIDIA_API_KEY: 'test-nvidia-key' });
  delete process.env.PAYPAL_BASE_URL;
  globalThis.fetch = fakeFetch;
  console.warn = () => {};
  orders = [
    { paypal_order_id: 'ORDER-7', user_id: INSTRUCTOR, student_name: 'Fall class', quantity: 7, amount: 343, currency: 'USD', status: 'COMPLETED' },
    { paypal_order_id: 'ORDER-OTHER', user_id: OTHER_INSTRUCTOR, student_name: 'Other class', quantity: 2, amount: 98, currency: 'USD', status: 'COMPLETED' },
    { paypal_order_id: 'ORDER-DONE', user_id: INSTRUCTOR, student_name: 'Fall class', quantity: 1, amount: 49, currency: 'USD', status: 'REFUNDED' },
  ];
  payments = [
    { capture_id: 'CAP-7', paypal_order_id: 'ORDER-7', user_id: INSTRUCTOR, amount: 343, currency: 'USD', status: 'COMPLETED' },
    { capture_id: 'CAP-OTHER', paypal_order_id: 'ORDER-OTHER', user_id: OTHER_INSTRUCTOR, amount: 98, currency: 'USD', status: 'COMPLETED' },
    { capture_id: 'CAP-DONE', paypal_order_id: 'ORDER-DONE', user_id: INSTRUCTOR, amount: 49, currency: 'USD', status: 'REFUNDED' },
  ];
  revokes = [];
  actions = [];
  refundRequests = [];
  authCalls = [];
  paypalRefund = (captureId) => Response.json({ id: `REF-${captureId}`, status: 'COMPLETED', amount: { value: '343.00', currency_code: 'USD' } }, { status: 201 });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('Confirm refunds the full captured amount through the Captures Refund API and revokes the seats', async () => {
  await serve(async (base) => {
    const response = await refund(base, 'CAP-7');
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(body, { refundId: 'REF-CAP-7', status: 'COMPLETED', captureId: 'CAP-7', orderId: 'ORDER-7', amount: '343.00', currency: 'USD', quantity: 7, className: 'Fall class', revoked: true, alreadyRevoked: false });
    assert.equal(refundRequests.length, 1);
    assert.equal(refundRequests[0].captureId, 'CAP-7');
    assert.deepEqual(refundRequests[0].body.amount, { value: '343.00', currency_code: 'USD' });
    assert.equal(refundRequests[0].headers['PayPal-Request-Id'], 'sentinel-refund-CAP-7');
    assert.equal(refundRequests[0].headers.Authorization, 'Bearer sandbox-token');
    assert.deepEqual(revokes.map((call) => [call.p_user_id, call.p_order_id, call.p_capture_id, call.p_refund_id, call.p_amount, call.p_currency]), [[INSTRUCTOR, 'ORDER-7', 'CAP-7', 'REF-CAP-7', '343.00', 'USD']]);
    assert.deepEqual(actions.map((row) => row.action), ['refund_issued']);
    assert.equal(payments[0].status, 'REFUNDED');
  });
});

test('a refund PayPal leaves PENDING is reported without revoking; the webhook revokes later', async () => {
  paypalRefund = (captureId) => Response.json({ id: `REF-${captureId}`, status: 'PENDING' }, { status: 201 });
  await serve(async (base) => {
    const response = await refund(base, 'CAP-7');
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.status, 'PENDING');
    assert.equal(body.revoked, false);
    assert.equal(revokes.length, 0);
    assert.equal(payments[0].status, 'COMPLETED');
  });
});

test('never refunds another instructor\'s capture, an unknown capture, or an already refunded one', async () => {
  await serve(async (base) => {
    const other = await refund(base, 'CAP-OTHER');
    assert.equal(other.status, 403);
    const unknown = await refund(base, 'CAP-NOPE');
    assert.equal(unknown.status, 404);
    const done = await refund(base, 'CAP-DONE');
    assert.equal(done.status, 409);
    const badId = await refund(base, encodeURIComponent('CAP 7!'));
    assert.equal(badId.status, 400);
    assert.equal(refundRequests.length, 0, 'PayPal was never called');
    assert.equal(revokes.length, 0);
    assert.deepEqual(actions.map((row) => row.action), ['refund_rejected', 'refund_rejected', 'refund_rejected']);
  });
});

test('requires a signed-in instructor, and a PayPal error is reported without revoking', async () => {
  await serve(async (base) => {
    const anonymous = await fetch(`${base}/api/paypal/captures/CAP-7/refund`, { method: 'POST' });
    assert.equal(anonymous.status, 401);
    const bad = await refund(base, 'CAP-7', 'wrong-token');
    assert.equal(bad.status, 401);
    assert.equal(refundRequests.length, 0);

    paypalRefund = () => Response.json({ name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', details: [{ issue: 'CAPTURE_FULLY_REFUNDED', description: 'Capture has already been fully refunded.' }] }, { status: 422 });
    const failed = await refund(base, 'CAP-7');
    assert.equal(failed.status, 422);
    assert.match((await failed.json()).error, /CAPTURE_FULLY_REFUNDED/);
    assert.equal(revokes.length, 0);
    assert.deepEqual(actions.map((row) => row.action), ['refund_failed']);
  });
});

test('a repeated Confirm sends the same PayPal-Request-Id, and an already revoked capture answers alreadyRevoked', async () => {
  // PayPal returns the original refund for a repeated request id; the stored payment is still
  // COMPLETED only if the first revoke never ran (e.g. a crash between the two), so revoke is retried.
  payments[0].status = 'COMPLETED';
  orders[0].status = 'COMPLETED';
  await serve(async (base) => {
    const first = await (await refund(base, 'CAP-7')).json();
    assert.equal(first.revoked, true);
    // After the first refund the payment is REFUNDED, so a second click is refused before PayPal.
    const second = await refund(base, 'CAP-7');
    assert.equal(second.status, 409);
    assert.equal(refundRequests.length, 1);
    assert.equal(refundRequests[0].headers['PayPal-Request-Id'], 'sentinel-refund-CAP-7');
  });
});
