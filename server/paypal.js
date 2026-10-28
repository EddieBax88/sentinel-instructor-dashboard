import { randomUUID } from 'node:crypto';
import { MAX_SEATS_PER_ORDER } from './config.js';
import { money } from './seatUnlock.js';
import { getPaypalOrder, grantSentinelVoltAccess, savePaypalOrder } from './supabase.js';

const SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const CURRENCY = 'USD';
const SEAT_PRICE = '49.00';
const COHORT_ID = 'sentinel-fall-2026';
export const SEAT_PRICING = Object.freeze({ unitPrice: SEAT_PRICE, currency: CURRENCY });
let tokenCache;

export function seatOrderTotal(quantity) {
  return ((Math.round(Number(SEAT_PRICE) * 100) * quantity) / 100).toFixed(2);
}

export function assertSeatQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SEATS_PER_ORDER) {
    throw Object.assign(new Error(`Quantity must be a whole number from 1 to ${MAX_SEATS_PER_ORDER}.`), { statusCode: 400 });
  }
}

// Checks a PayPal capture against the stored paypal_orders row before any seat is granted.
function assertStoredOrderPrice(order) {
  const expectedTotal = seatOrderTotal(Number(order.quantity ?? 1));
  if (money(order.amount) !== expectedTotal || order.currency !== CURRENCY) {
    throw Object.assign(new Error('The stored seat order does not match the fixed seat price.'), { statusCode: 409 });
  }
  return expectedTotal;
}

export function verifyCaptureForOrder(order, capture) {
  if (capture.status !== 'COMPLETED' || !capture.captureId) {
    throw Object.assign(new Error('A completed PayPal capture is required before unlocking seats.'), { statusCode: 409 });
  }
  const expectedTotal = assertStoredOrderPrice(order);
  if (money(capture.amount) !== expectedTotal || capture.currency !== CURRENCY) {
    throw Object.assign(new Error('Capture amount or currency does not match the seat order.'), { statusCode: 409 });
  }
  return { ...capture, amount: expectedTotal, currency: CURRENCY };
}

function completedTransaction(order, capture) {
  return {
    orderId: order.paypal_order_id,
    captureId: capture.captureId,
    studentName: order.student_name,
    quantity: Number(order.quantity ?? 1),
    amount: money(order.amount),
    currency: order.currency,
    status: 'COMPLETED',
  };
}

function storedCapture(order) {
  const payment = Array.isArray(order.paypal_payments) ? order.paypal_payments[0] : order.paypal_payments;
  return { captureId: payment?.capture_id ?? '' };
}

function configuration() {
  const { PAYPAL_CLIENT_ID, PAYPAL_SECRET } = process.env;
  const configuredBase = process.env.PAYPAL_BASE_URL || SANDBOX_API;
  let configuredUrl;

  try {
    configuredUrl = new URL(configuredBase);
  } catch {
    throw Object.assign(new Error('PAYPAL_BASE_URL must be the PayPal sandbox API URL.'), { statusCode: 500 });
  }

  if (configuredUrl.origin !== SANDBOX_API) {
    throw Object.assign(new Error('Live PayPal endpoints are disabled. Use https://api-m.sandbox.paypal.com.'), { statusCode: 500 });
  }
  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET || PAYPAL_CLIENT_ID.startsWith('your_') || PAYPAL_SECRET.startsWith('your_')) {
    throw Object.assign(new Error('Add sandbox PAYPAL_CLIENT_ID and PAYPAL_SECRET values to .env.'), { statusCode: 503 });
  }

  return { clientId: PAYPAL_CLIENT_ID, secret: PAYPAL_SECRET };
}

export function isPaypalConfigured() {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}

async function paypalFetch(path, options = {}) {
  const accessToken = await getAccessToken();
  const requestBody =
    options.rawJsonBody ??
    (options.body
      ? typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
      : undefined);

  const response = await fetch(`${SANDBOX_API}${path}`, {
    ...options,
    body: requestBody,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    let errorMsg = payload.message || `PayPal sandbox request failed (${response.status}).`;
    if (payload.details && payload.details.length > 0) {
      const issue = payload.details[0];
      errorMsg = `${issue.field ? issue.field + ': ' : ''}${issue.issue || issue.description || errorMsg}`;
    }
    throw Object.assign(new Error(errorMsg), {
      statusCode: response.status >= 500 ? 502 : response.status,
    });
  }
  return payload;
}

async function getAccessToken() {
  const { clientId, secret } = configuration();
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.value;

  const response = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw Object.assign(new Error(payload.error_description || 'Could not authenticate with PayPal sandbox.'), { statusCode: 502 });
  }

  tokenCache = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return tokenCache.value;
}

export async function createSandboxOrder({ studentName, userId, quantity = 1 }) {
  const normalizedName = typeof studentName === 'string' ? studentName.trim().slice(0, 80) : '';
  if (!normalizedName) {
    throw Object.assign(new Error('Enter a student name before starting checkout.'), { statusCode: 400 });
  }
  if (!userId) {
    throw Object.assign(new Error('A verified Supabase account is required to start checkout.'), { statusCode: 401 });
  }
  assertSeatQuantity(quantity);
  const total = seatOrderTotal(quantity);

  const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const order = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': randomUUID(), Prefer: 'return=representation' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: COHORT_ID,
        custom_id: userId,
        invoice_id: `SENTINEL-${randomUUID()}`,
        description: quantity === 1 ? 'One instructor course seat' : `${quantity} instructor course seats`,
        amount: {
          currency_code: CURRENCY,
          value: total,
          breakdown: {
            item_total: { currency_code: CURRENCY, value: total },
          },
        },
        items: [{
          name: 'Course seat',
          description: 'One seat in the Sentinel Fall 2026 cohort',
          quantity: String(quantity),
          unit_amount: { currency_code: CURRENCY, value: SEAT_PRICE },
          category: 'DIGITAL_GOODS',
        }],
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Sentinel Instructor Dashboard',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: `${appBaseUrl}/?checkout=return`,
            cancel_url: `${appBaseUrl}/?checkout=cancelled`,
          },
        },
      },
    }),
  });

  if (!order.id || !['CREATED', 'PAYER_ACTION_REQUIRED'].includes(order.status)) {
    throw Object.assign(new Error('PayPal sandbox did not create an approvable order.'), { statusCode: 502 });
  }
  const approvalLink = order.links?.find(({ rel }) => rel === 'payer-action' || rel === 'approve');
  if (!approvalLink) {
    throw Object.assign(new Error('PayPal sandbox did not return an approval link.'), { statusCode: 502 });
  }
  const approvalUrl = new URL(approvalLink.href);
  if (approvalUrl.protocol !== 'https:' || approvalUrl.hostname !== 'www.sandbox.paypal.com') {
    throw Object.assign(new Error('PayPal returned a non-sandbox approval URL; checkout was stopped.'), { statusCode: 502 });
  }

  await savePaypalOrder({
    orderId: order.id,
    userId,
    studentName: normalizedName,
    quantity,
    amount: total,
    currency: CURRENCY,
  });
  return { orderId: order.id, approvalUrl: approvalUrl.toString(), quantity, amount: total, currency: CURRENCY };
}

// Reads the order from Supabase, so capture works after a server restart. The grant function
// marks the order completed and writes paypal_payments in one transaction, and returns early
// for a capture it has already recorded, so repeats never grant twice.
export async function captureSandboxOrder(orderId, userId) {
  const order = await getPaypalOrder(orderId);
  if (order.user_id !== userId) {
    throw Object.assign(new Error('This PayPal order does not belong to the authenticated account.'), { statusCode: 403 });
  }
  if (order.status === 'COMPLETED') {
    return { transaction: completedTransaction(order, storedCapture(order)), alreadyCaptured: true };
  }
  assertStoredOrderPrice(order);

  let captureResponse;
  try {
    // A fixed request ID makes PayPal return the original result for a repeated capture.
    captureResponse = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: { 'PayPal-Request-Id': `sentinel-capture-${orderId}`, Prefer: 'return=representation' },
      body: JSON.stringify({}),
    });
  } catch (error) {
    // A concurrent capture or webhook may have completed the order first.
    const latest = await getPaypalOrder(orderId);
    if (latest.status === 'COMPLETED') {
      return { transaction: completedTransaction(latest, storedCapture(latest)), alreadyCaptured: true };
    }
    throw error;
  }
  const completedCapture = captureResponse.purchase_units?.flatMap((unit) => unit.payments?.captures || [])
    .find((item) => item.status === 'COMPLETED');
  if (captureResponse.status !== 'COMPLETED' || !completedCapture) {
    throw Object.assign(new Error('PayPal has not confirmed a completed capture; no seat was unlocked.'), { statusCode: 409 });
  }

  const capture = verifyCaptureForOrder(order, {
    captureId: completedCapture.id,
    status: completedCapture.status,
    amount: completedCapture.amount?.value,
    currency: completedCapture.amount?.currency_code,
  });
  await grantSentinelVoltAccess({ userId: order.user_id, orderId, ...capture });
  return { transaction: completedTransaction(order, capture), alreadyCaptured: false };
}

export async function verifySandboxWebhook(event, headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || webhookId.startsWith('your_')) {
    throw Object.assign(new Error('Set PAYPAL_WEBHOOK_ID to verify PayPal webhook events.'), { statusCode: 503 });
  }
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  const requiredHeaders = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
  };
  if (Object.values(requiredHeaders).some((value) => !value)) return false;

  const verificationMetadata = JSON.stringify({ ...requiredHeaders, webhook_id: webhookId });
  const rawEvent = rawBody.toString('utf8');
  const verification = await paypalFetch('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    rawJsonBody: `${verificationMetadata.slice(0, -1)},"webhook_event":${rawEvent}}`,
  });
  return verification.verification_status === 'SUCCESS';
}