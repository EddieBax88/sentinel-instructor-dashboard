function supabaseConfiguration() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'), { statusCode: 503 });
  }

  let baseUrl;
  try {
    baseUrl = new URL(SUPABASE_URL);
  } catch {
    throw Object.assign(new Error('SUPABASE_URL must be a valid URL.'), { statusCode: 503 });
  }

  return { baseUrl: baseUrl.toString().replace(/\/$/, ''), anonKey: SUPABASE_ANON_KEY, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY };
}

export function isSupabaseConfigured() {
  try {
    supabaseConfiguration();
    return true;
  } catch {
    return false;
  }
}

export function publicSupabaseConfiguration() {
  const { baseUrl, anonKey } = supabaseConfiguration();
  if (anonKey.startsWith('sb_secret_')) {
    throw Object.assign(new Error('SUPABASE_ANON_KEY must be a publishable key, not a secret key.'), { statusCode: 503 });
  }
  return { url: baseUrl, publishableKey: anonKey };
}

// sb_secret_ keys are not JWTs: Supabase accepts them only on the apikey header.
// Legacy service_role JWTs still need the matching Bearer header.
function serviceHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    ...(serviceRoleKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${serviceRoleKey}` }),
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export function getBearerToken(authorization) {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization || '');
  if (!match) {
    throw Object.assign(new Error('A valid Supabase access token is required.'), { statusCode: 401 });
  }
  return match[1];
}

export async function authenticateSupabaseUser(accessToken) {
  if (!accessToken) {
    throw Object.assign(new Error('A valid Supabase access token is required.'), { statusCode: 401 });
  }

  const { baseUrl, anonKey } = supabaseConfiguration();
  const response = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const user = await readJson(response);
  if (!response.ok || typeof user.id !== 'string') {
    throw Object.assign(new Error('The Supabase access token is invalid or expired.'), { statusCode: 401 });
  }

  return { id: user.id };
}

export async function savePaypalOrder({ orderId, userId, studentName, quantity = 1, amount, currency }) {
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const response = await fetch(`${baseUrl}/rest/v1/paypal_orders`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      paypal_order_id: orderId,
      user_id: userId,
      student_name: studentName,
      quantity,
      amount,
      currency,
      status: 'PENDING',
    }),
  });

  if (!response.ok) {
    await readJson(response);
    throw Object.assign(new Error(`Could not persist the PayPal order in Supabase (${response.status}).`), { statusCode: 502 });
  }
}

export async function getPaypalOrder(orderId) {
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const query = new URLSearchParams({
    select: 'paypal_order_id,user_id,student_name,quantity,amount,currency,status,paypal_payments(capture_id)',
    paypal_order_id: `eq.${orderId}`,
    limit: '1',
  });
  const response = await fetch(`${baseUrl}/rest/v1/paypal_orders?${query}`, {
    headers: serviceHeaders(serviceRoleKey, { Accept: 'application/json' }),
  });
  const rows = await readJson(response);
  if (!response.ok) {
    throw Object.assign(new Error(`Could not read the PayPal order from Supabase (${response.status}).`), { statusCode: 502 });
  }
  if (!Array.isArray(rows) || !rows[0]) {
    throw Object.assign(new Error('No seat order matches this PayPal order.'), { statusCode: 404 });
  }
  return rows[0];
}

// Reads only the verified user's orders: userId always comes from authenticateSupabaseUser.
export async function listPaypalOrdersForUser(userId) {
  if (!userId) {
    throw Object.assign(new Error('A verified Supabase account is required.'), { statusCode: 401 });
  }
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const query = new URLSearchParams({
    select: 'paypal_order_id,student_name,quantity,amount,currency,status,created_at,paypal_payments(capture_id,created_at)',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '500',
  });
  const response = await fetch(`${baseUrl}/rest/v1/paypal_orders?${query}`, {
    headers: serviceHeaders(serviceRoleKey, { Accept: 'application/json' }),
  });
  const rows = await readJson(response);
  if (!response.ok || !Array.isArray(rows)) {
    throw Object.assign(new Error(`Could not read seat orders from Supabase (${response.status}).`), { statusCode: 502 });
  }
  return rows;
}

// The seat order behind a PayPal capture ID, with the recorded payment, for refund webhooks
// (the refund names its capture, not the order). Returns null when no stored capture matches.
export async function getPaypalOrderByCaptureId(captureId) {
  if (typeof captureId !== 'string' || !captureId) return null;
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const query = new URLSearchParams({
    select: 'capture_id,amount,currency,status,paypal_orders(paypal_order_id,user_id,student_name,quantity,amount,currency,status)',
    capture_id: `eq.${captureId}`,
    limit: '1',
  });
  const response = await fetch(`${baseUrl}/rest/v1/paypal_payments?${query}`, {
    headers: serviceHeaders(serviceRoleKey, { Accept: 'application/json' }),
  });
  const rows = await readJson(response);
  if (!response.ok || !Array.isArray(rows)) {
    throw Object.assign(new Error(`Could not read the PayPal capture from Supabase (${response.status}).`), { statusCode: 502 });
  }
  const row = rows[0];
  if (!row?.paypal_orders) return null;
  return {
    payment: { captureId: row.capture_id, amount: row.amount, currency: row.currency, status: row.status },
    order: row.paypal_orders,
  };
}

// Supabase function that records a verified capture and grants the seats (see supabase/migrations).
export const SEAT_GRANT_FUNCTION = 'grant_seat_access';
// Its counterpart for a full refund: marks the payment and order REFUNDED and deactivates the seat
// entitlement when no completed order remains. Returns 'revoked' or 'already_revoked'.
export const SEAT_REVOKE_FUNCTION = 'revoke_seat_access';

export async function grantSeatAccess({ userId, orderId, captureId, status, amount, currency }) {
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${SEAT_GRANT_FUNCTION}`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      p_user_id: userId,
      p_order_id: orderId,
      p_capture_id: captureId,
      p_status: status,
      p_amount: amount,
      p_currency: currency,
    }),
  });
  if (!response.ok) {
    await readJson(response);
    throw Object.assign(new Error(`Supabase could not grant seat access (${response.status}).`), { statusCode: 502 });
  }
}

export async function revokeSeatAccess({ userId, orderId, captureId, refundId, amount, currency }) {
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${SEAT_REVOKE_FUNCTION}`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey, { Accept: 'application/json' }),
    body: JSON.stringify({
      p_user_id: userId,
      p_order_id: orderId,
      p_capture_id: captureId,
      p_refund_id: refundId,
      p_amount: amount,
      p_currency: currency,
    }),
  });
  const result = await readJson(response);
  if (!response.ok) {
    throw Object.assign(new Error(`Supabase could not revoke seat access (${response.status}).`), { statusCode: 502 });
  }
  return result === 'already_revoked' ? 'already_revoked' : 'revoked';
}

export async function logAgentAction({ userId, action, details = {} }) {
  try {
    const { baseUrl, serviceRoleKey } = supabaseConfiguration();
    const response = await fetch(`${baseUrl}/rest/v1/agent_actions`, {
      method: 'POST',
      headers: serviceHeaders(serviceRoleKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ user_id: userId, action, details }),
    });
    if (!response.ok) console.warn(`Agent action "${action}" was not logged (Supabase ${response.status}).`);
  } catch (error) {
    console.warn(`Agent action "${action}" was not logged: ${error.message}`);
  }
}

// Seat proposals (see supabase/migrations/20261031180000_seat_proposals.sql). Server-only table.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const proposalFromRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  quantity: row.quantity,
  className: row.class_name,
  expiresAt: Date.parse(row.expires_at),
});

export async function saveSeatProposal({ id, userId, quantity, className, unitPrice, total, currency, expiresAt }) {
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const response = await fetch(`${baseUrl}/rest/v1/seat_proposals`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      id,
      user_id: userId,
      quantity,
      class_name: className,
      unit_price: unitPrice,
      total,
      currency,
      expires_at: new Date(expiresAt).toISOString(),
    }),
  });
  if (!response.ok) {
    await readJson(response);
    throw Object.assign(new Error(`Could not save the seat proposal in Supabase (${response.status}).`), { statusCode: 502 });
  }
}

// Takes the proposal if it belongs to userId and has not expired at `now`: one DELETE, so two
// confirms of the same proposal cannot both get it. Returns null when nothing matched.
export async function claimSeatProposal({ proposalId, userId, now }) {
  if (!UUID.test(String(proposalId))) return null;
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const query = new URLSearchParams({
    id: `eq.${proposalId}`,
    user_id: `eq.${userId}`,
    expires_at: `gt.${new Date(now).toISOString()}`,
    select: 'id,user_id,quantity,class_name,expires_at',
  });
  const response = await fetch(`${baseUrl}/rest/v1/seat_proposals?${query}`, {
    method: 'DELETE',
    headers: serviceHeaders(serviceRoleKey, { Prefer: 'return=representation', Accept: 'application/json' }),
  });
  const rows = await readJson(response);
  if (!response.ok || !Array.isArray(rows)) {
    throw Object.assign(new Error(`Could not read the seat proposal from Supabase (${response.status}).`), { statusCode: 502 });
  }
  return rows[0] ? proposalFromRow(rows[0]) : null;
}

// Reads a proposal by ID regardless of owner, to tell "another account's proposal" from "gone".
export async function getSeatProposal(proposalId) {
  if (!UUID.test(String(proposalId))) return null;
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const query = new URLSearchParams({ id: `eq.${proposalId}`, select: 'id,user_id,quantity,class_name,expires_at', limit: '1' });
  const response = await fetch(`${baseUrl}/rest/v1/seat_proposals?${query}`, {
    headers: serviceHeaders(serviceRoleKey, { Accept: 'application/json' }),
  });
  const rows = await readJson(response);
  if (!response.ok || !Array.isArray(rows)) {
    throw Object.assign(new Error(`Could not read the seat proposal from Supabase (${response.status}).`), { statusCode: 502 });
  }
  return rows[0] ? proposalFromRow(rows[0]) : null;
}

// Verified PayPal webhook events (see supabase/migrations/20261101200000_paypal_webhook_events.sql).
// Server-only table. A retried event (same event_id) is ignored, not an error.
export async function recordWebhookEvent(row) {
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const response = await fetch(`${baseUrl}/rest/v1/paypal_webhook_events?on_conflict=event_id`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    await readJson(response);
    throw Object.assign(new Error(`Could not record the PayPal event in Supabase (${response.status}).`), { statusCode: 502 });
  }
}

// Reads only the verified user's events: userId always comes from authenticateSupabaseUser.
export async function listWebhookEventsForUser(userId, limit = 50) {
  if (!userId) {
    throw Object.assign(new Error('A verified Supabase account is required.'), { statusCode: 401 });
  }
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const query = new URLSearchParams({
    select: 'event_id,event_type,resource_type,resource_id,resource_status,paypal_order_id,amount,currency,event_created_at,received_at',
    user_id: `eq.${userId}`,
    order: 'received_at.desc',
    limit: String(limit),
  });
  const response = await fetch(`${baseUrl}/rest/v1/paypal_webhook_events?${query}`, {
    headers: serviceHeaders(serviceRoleKey, { Accept: 'application/json' }),
  });
  const rows = await readJson(response);
  if (!response.ok || !Array.isArray(rows)) {
    throw Object.assign(new Error(`Could not read PayPal events from Supabase (${response.status}).`), { statusCode: 502 });
  }
  return rows;
}

// Demo reset: the tables that hold one instructor's sandbox data, in an order that respects the
// foreign keys (entitlements reference payments, payments reference orders).
export const DEMO_RESET_TABLES = Object.freeze(['user_entitlements', 'paypal_payments', 'paypal_orders', 'seat_proposals', 'paypal_webhook_events', 'agent_actions']);

// Deletes ONLY the given instructor's rows from each demo table. Every DELETE carries a user_id
// filter (PostgREST applies it server-side with the secret key), asks for the deleted rows back,
// and the rows are checked again here: a row with another user_id aborts before the next table.
// userId always comes from authenticateSupabaseUser, never from the request. Not one transaction:
// a failure part-way leaves earlier tables already cleared, which a second reset finishes.
export async function resetDemoDataForUser(userId) {
  if (typeof userId !== 'string' || !UUID.test(userId)) {
    throw Object.assign(new Error('A verified Supabase account is required.'), { statusCode: 401 });
  }
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const deleted = {};
  for (const table of DEMO_RESET_TABLES) {
    const query = new URLSearchParams({ user_id: `eq.${userId}`, select: 'user_id' });
    const response = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: serviceHeaders(serviceRoleKey, { Prefer: 'return=representation', Accept: 'application/json' }),
    });
    const rows = await readJson(response);
    if (!response.ok || !Array.isArray(rows)) {
      throw Object.assign(new Error(`Could not reset ${table} (Supabase ${response.status}).`), { statusCode: 502 });
    }
    const foreign = rows.filter((row) => row.user_id !== userId);
    if (foreign.length) {
      throw Object.assign(new Error(`Reset of ${table} touched a row that is not yours; stopped.`), { statusCode: 500 });
    }
    deleted[table] = rows.length;
  }
  return deleted;
}

// Keep-alive for the free-plan project: one head-only count on paypal_orders with the service
// role. HEAD returns no rows, only a Content-Range header, and the caller never sees even that.
export async function pingSupabase() {
  const { baseUrl, serviceRoleKey } = supabaseConfiguration();
  const response = await fetch(`${baseUrl}/rest/v1/paypal_orders?select=paypal_order_id&limit=1`, {
    method: 'HEAD',
    headers: serviceHeaders(serviceRoleKey, { Prefer: 'count=exact' }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Supabase keep-alive failed (${response.status}).`), { statusCode: 502 });
  }
}
