import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler, { restoreApiUrl } from '../api/index.js';

test('restoreApiUrl rebuilds the /api path from the rewrite parameter and keeps other query parameters', () => {
  assert.equal(restoreApiUrl('/api?__route=health'), '/api/health');
  assert.equal(restoreApiUrl('/api?__route=paypal%2Forders%2FORDER-1%2Fcapture'), '/api/paypal/orders/ORDER-1/capture');
  assert.equal(restoreApiUrl('/api?__route=paypal/orders/ORDER-1/capture&x=1'), '/api/paypal/orders/ORDER-1/capture?x=1');
  // Already the original path (no rewrite, or a platform that keeps it): left alone.
  assert.equal(restoreApiUrl('/api/ledger'), '/api/ledger');
  assert.equal(restoreApiUrl('/api/ledger?__route=ledger'), '/api/ledger');
  assert.equal(restoreApiUrl('/api'), '/api');
});

async function serve(fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the Vercel entry serves the Express API for rewritten and original paths', async () => {
  await serve(async (base) => {
    for (const path of ['/api?__route=health', '/api/health']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.deepEqual(await response.json(), { status: 'ok', environment: 'sandbox-only' });
    }
  });
});

test('through the Vercel entry, the PayPal webhook is verified with the raw body exactly as received', async () => {
  const names = ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_BASE_URL', 'PAYPAL_WEBHOOK_ID'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, { PAYPAL_CLIENT_ID: 'sandbox_test_client', PAYPAL_SECRET: 'sandbox_test_secret', PAYPAL_WEBHOOK_ID: 'sandbox_webhook_id' });
  delete process.env.PAYPAL_BASE_URL;
  const realFetch = globalThis.fetch;
  let verifyBody;
  globalThis.fetch = async (url, options = {}) => {
    const { hostname, pathname } = new URL(url);
    if (hostname === '127.0.0.1') return realFetch(url, options);
    if (pathname === '/v1/oauth2/token') return Response.json({ access_token: 'sandbox-token', expires_in: 3600 });
    if (pathname === '/v1/notifications/verify-webhook-signature') {
      verifyBody = options.body;
      return Response.json({ verification_status: 'FAILURE' });
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  // Unusual spacing and key order: re-serializing the parsed JSON would change these bytes.
  const raw = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"49.00"}, "id":"CAP-1"}}';
  try {
    await serve(async (base) => {
      const response = await realFetch(`${base}/api?__route=paypal/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
          'paypal-transmission-id': 'tx-1',
          'paypal-transmission-sig': 'sig',
          'paypal-transmission-time': '2026-10-31T00:00:00Z',
        },
        body: raw,
      });
      assert.equal(response.status, 400);
    });
    assert.ok(verifyBody.endsWith(`"webhook_event":${raw}}`), 'the raw event bytes are posted back unchanged');
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
