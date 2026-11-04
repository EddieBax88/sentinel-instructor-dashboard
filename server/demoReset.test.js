// POST /api/demo/reset against a fake Supabase that holds rows for two instructors and applies
// PostgREST's user_id filter exactly as the real one would. Proves the reset deletes only the
// signed-in instructor's rows, in foreign-key order, and refuses anything else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_RESET_TABLES, resetDemoDataForUser } from './supabase.js';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_BASE_URL', 'NVIDIA_API_KEY'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

let tables;
let deletes;
let actions;
let misbehave;

const seed = () => ({
  user_entitlements: [{ user_id: INSTRUCTOR, product_code: 'sentinel_volt' }, { user_id: OTHER, product_code: 'sentinel_volt' }],
  paypal_payments: [{ user_id: INSTRUCTOR, capture_id: 'CAP-A' }, { user_id: INSTRUCTOR, capture_id: 'CAP-B' }, { user_id: OTHER, capture_id: 'CAP-O' }],
  paypal_orders: [{ user_id: INSTRUCTOR, paypal_order_id: 'ORDER-A' }, { user_id: INSTRUCTOR, paypal_order_id: 'ORDER-B' }, { user_id: INSTRUCTOR, paypal_order_id: 'ORDER-C' }, { user_id: OTHER, paypal_order_id: 'ORDER-O' }],
  seat_proposals: [{ user_id: OTHER, id: 'p-o' }],
  paypal_webhook_events: [{ user_id: INSTRUCTOR, event_id: 'WH-1' }, { user_id: null, event_id: 'WH-orphan' }, { user_id: OTHER, event_id: 'WH-O' }],
  agent_actions: [{ user_id: INSTRUCTOR, action: 'chat_request' }, { user_id: OTHER, action: 'chat_request' }],
});

async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1') return originalFetch(url, options);
  if (hostname !== 'example.supabase.co') throw new Error(`Unexpected request to ${url}`);
  if (pathname === '/auth/v1/user') {
    return options.headers.Authorization === 'Bearer instructor-token' ? Response.json({ id: INSTRUCTOR }) : Response.json({}, { status: 401 });
  }
  const table = pathname.replace('/rest/v1/', '');
  if (options.method === 'DELETE') {
    deletes.push({ table, filter: searchParams.get('user_id'), prefer: options.headers.Prefer });
    const filter = searchParams.get('user_id');
    if (misbehave === 'ignore-filter') return Response.json(tables[table]);
    if (misbehave === 'fail' && table === 'paypal_orders') return Response.json({ message: 'boom' }, { status: 500 });
    // PostgREST semantics: only rows matching user_id=eq.<id> are deleted and returned.
    const [operator, operand] = filter ? [filter.slice(0, 2), filter.slice(3)] : [null, null];
    assert.equal(operator, 'eq', 'every delete must filter on user_id');
    const removed = tables[table].filter((row) => row.user_id === operand);
    tables[table] = tables[table].filter((row) => row.user_id !== operand);
    return Response.json(removed);
  }
  if (table === 'agent_actions' && options.method === 'POST') {
    actions.push(JSON.parse(options.body));
    return new Response(null, { status: 201 });
  }
  throw new Error(`Unexpected ${options.method} ${pathname}`);
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

test.beforeEach(() => {
  Object.assign(process.env, { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key', PAYPAL_CLIENT_ID: 'sandbox_test_client', PAYPAL_SECRET: 'sandbox_test_secret' });
  delete process.env.PAYPAL_BASE_URL;
  globalThis.fetch = fakeFetch;
  console.warn = () => {};
  tables = seed();
  deletes = [];
  actions = [];
  misbehave = null;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('reset deletes only the signed-in instructor\'s rows, in foreign-key order, and leaves every other row', async () => {
  await serve(async (base) => {
    const response = await fetch(`${base}/api/demo/reset`, { method: 'POST', headers: { Authorization: 'Bearer instructor-token' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reset: true, deleted: { user_entitlements: 1, paypal_payments: 2, paypal_orders: 3, seat_proposals: 0, paypal_webhook_events: 1, agent_actions: 1 } });
  });
  assert.deepEqual(deletes.map((call) => call.table), [...DEMO_RESET_TABLES]);
  assert.deepEqual(DEMO_RESET_TABLES.slice(0, 3), ['user_entitlements', 'paypal_payments', 'paypal_orders'], 'entitlements before payments before orders');
  assert.ok(deletes.every((call) => call.filter === `eq.${INSTRUCTOR}` && /return=representation/.test(call.prefer)));
  // The other instructor's rows, and the orphan event with no user, are untouched.
  for (const table of DEMO_RESET_TABLES) {
    assert.equal(tables[table].filter((row) => row.user_id === INSTRUCTOR).length, 0, `${table} still has the instructor's rows`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])), { user_entitlements: 1, paypal_payments: 1, paypal_orders: 1, seat_proposals: 1, paypal_webhook_events: 2, agent_actions: 1 });
  assert.ok(tables.paypal_webhook_events.some((row) => row.event_id === 'WH-orphan'));
  // The reset itself is logged after the delete, so the audit row survives.
  assert.deepEqual(actions.map((row) => [row.user_id, row.action]), [[INSTRUCTOR, 'demo_reset']]);
  assert.deepEqual(actions[0].details.deleted.paypal_orders, 3);
});

test('refuses without a signed-in instructor, and sends no delete', async () => {
  await serve(async (base) => {
    assert.equal((await fetch(`${base}/api/demo/reset`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/demo/reset`, { method: 'POST', headers: { Authorization: 'Bearer stranger' } })).status, 401);
  });
  assert.equal(deletes.length, 0);
  assert.deepEqual(tables, seed());
});

test('refuses outside the PayPal sandbox configuration', async () => {
  process.env.PAYPAL_BASE_URL = 'https://api-m.paypal.com';
  await serve(async (base) => {
    const response = await fetch(`${base}/api/demo/reset`, { method: 'POST', headers: { Authorization: 'Bearer instructor-token' } });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Live PayPal endpoints are disabled/);
  });
  assert.equal(deletes.length, 0);
});

test('stops before the next table if a delete ever returned a row that is not the instructor\'s', async () => {
  misbehave = 'ignore-filter';
  await assert.rejects(resetDemoDataForUser(INSTRUCTOR), /touched a row that is not yours/);
  assert.equal(deletes.length, 1, 'stopped after the first table');
});

test('a Supabase failure part-way is reported as 502 and a second reset finishes the job', async () => {
  misbehave = 'fail';
  await serve(async (base) => {
    const response = await fetch(`${base}/api/demo/reset`, { method: 'POST', headers: { Authorization: 'Bearer instructor-token' } });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /paypal_orders/);
  });
  assert.equal(actions.length, 0, 'nothing is logged as reset');
  misbehave = null;
  const deleted = await resetDemoDataForUser(INSTRUCTOR);
  assert.deepEqual(deleted, { user_entitlements: 0, paypal_payments: 0, paypal_orders: 3, seat_proposals: 0, paypal_webhook_events: 1, agent_actions: 1 });
  assert.equal(tables.paypal_orders.length, 1);
});

test('rejects a user id that is not a UUID before touching Supabase', async () => {
  await assert.rejects(resetDemoDataForUser('*'), { statusCode: 401 });
  await assert.rejects(resetDemoDataForUser(undefined), { statusCode: 401 });
  assert.equal(deletes.length, 0);
});
