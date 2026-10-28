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

// Supabase function that records a verified capture and grants the seats (see supabase/migrations).
export const SEAT_GRANT_FUNCTION = 'grant_seat_access';

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
