import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxOrder } from './paypal.js';

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
    await assert.rejects(createSandboxOrder({ studentName: 'Demo Student' }), /Live PayPal endpoints are disabled/);
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