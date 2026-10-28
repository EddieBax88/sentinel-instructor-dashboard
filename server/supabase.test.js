import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateSupabaseUser,
  getPaypalOrder,
  grantSentinelVoltAccess,
  listPaypalOrdersForUser,
  publicSupabaseConfiguration,
  savePaypalOrder,
} from './supabase.js';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

test.beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnvironment.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalEnvironment.url;
  if (originalEnvironment.anonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalEnvironment.anonKey;
  if (originalEnvironment.serviceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnvironment.serviceRoleKey;
});

test('validates the access token with Supabase Auth and returns only the account id', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.supabase.co/auth/v1/user');
    assert.equal(options.headers.Authorization, 'Bearer signed-user-token');
    assert.equal(options.headers.apikey, 'test-anon-key');
    return Response.json({ id: 'user-123', email: 'private@example.test' });
  };

  assert.deepEqual(await authenticateSupabaseUser('signed-user-token'), { id: 'user-123' });
});

test('does not accept an invalid Supabase access token', async () => {
  globalThis.fetch = async () => Response.json({ message: 'invalid' }, { status: 401 });
  await assert.rejects(authenticateSupabaseUser('expired-token'), {
    message: 'The Supabase access token is invalid or expired.',
    statusCode: 401,
  });
});

test('persists account association for a created PayPal order', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.supabase.co/rest/v1/paypal_orders');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-service-role-key');
    assert.deepEqual(JSON.parse(options.body), {
      paypal_order_id: 'ORDER-1',
      user_id: 'user-123',
      student_name: 'Avery',
      quantity: 1,
      amount: '49.00',
      currency: 'USD',
      status: 'PENDING',
    });
    return new Response(null, { status: 201 });
  };

  await savePaypalOrder({
    orderId: 'ORDER-1',
    userId: 'user-123',
    studentName: 'Avery',
    amount: '49.00',
    currency: 'USD',
  });
});

test('reads the durable user association by PayPal order id', async () => {
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(url);
    assert.equal(requestUrl.pathname, '/rest/v1/paypal_orders');
    assert.equal(requestUrl.searchParams.get('paypal_order_id'), 'eq.ORDER-1');
    return Response.json([{
      paypal_order_id: 'ORDER-1',
      user_id: 'user-123',
      student_name: 'Avery',
      amount: '49.00',
      currency: 'USD',
      status: 'PENDING',
    }]);
  };

  assert.equal((await getPaypalOrder('ORDER-1')).user_id, 'user-123');
});

test('calls the atomic Sentinel Volt entitlement grant function', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/grant_sentinel_volt_access');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-service-role-key');
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: 'user-123',
      p_order_id: 'ORDER-1',
      p_capture_id: 'CAPTURE-1',
      p_status: 'COMPLETED',
      p_amount: '49.00',
      p_currency: 'USD',
    });
    return new Response(null, { status: 204 });
  };

  await grantSentinelVoltAccess({
    userId: 'user-123',
    orderId: 'ORDER-1',
    captureId: 'CAPTURE-1',
    status: 'COMPLETED',
    amount: '49.00',
    currency: 'USD',
  });
});

test('sends sb_secret_ keys only on the apikey header', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(null, { status: 201 });
  };

  await savePaypalOrder({
    orderId: 'ORDER-1',
    userId: 'user-123',
    studentName: 'Avery',
    amount: '49.00',
    currency: 'USD',
  });
});

test('exposes only the URL and publishable key to the browser', () => {
  assert.deepEqual(publicSupabaseConfiguration(), { url: 'https://example.supabase.co', publishableKey: 'test-anon-key' });
  process.env.SUPABASE_ANON_KEY = 'sb_secret_test';
  assert.throws(() => publicSupabaseConfiguration(), { statusCode: 503 });
});

test("reads only the verified user's orders, with the secret key on the server", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(url);
    assert.equal(requestUrl.pathname, '/rest/v1/paypal_orders');
    assert.equal(requestUrl.searchParams.get('user_id'), 'eq.user-123');
    assert.match(requestUrl.searchParams.get('select'), /quantity/);
    assert.match(requestUrl.searchParams.get('select'), /paypal_payments\(capture_id/);
    assert.equal(options.headers.apikey, 'sb_secret_test');
    return Response.json([{ paypal_order_id: 'ORDER-1', quantity: 30, amount: 1470, status: 'PENDING' }]);
  };

  const rows = await listPaypalOrdersForUser('user-123');
  assert.equal(rows[0].quantity, 30);
});

test('refuses to list orders without a verified user id and surfaces Supabase errors', async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected request'); };
  await assert.rejects(listPaypalOrdersForUser(undefined), { statusCode: 401 });

  globalThis.fetch = async () => Response.json({ message: 'permission denied' }, { status: 401 });
  await assert.rejects(listPaypalOrdersForUser('user-123'), { statusCode: 502 });
});
