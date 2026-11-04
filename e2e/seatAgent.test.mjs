// Headless browser test of the Seat agent in Ask AI, against the real Express app (server/app.js):
// /api/agent/chat runs server/agent.js and the confirm endpoint runs server/paypal.js. Only outside
// services are faked: Supabase, the Anthropic Messages API (the seat assistant's model), PayPal
// Sandbox, and the Ask AI lead's model turns (scripted in the browser).
//
//   npm run test:browser       (needs Playwright's Chromium once: npx playwright install chromium)

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const ORDER_ID = 'ORDER-SEAT-12';
const APPROVAL_URL = `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}`;
const originalFetch = globalThis.fetch;
// Each browser test file runs in its own process with its own Vite dev server; Vite's HMR socket
// defaults to one fixed port (24678), so the second server would fail. Give each a free port.
const freePort = () => new Promise((resolve) => {
  const probe = createNetServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const calls = { auth: [], claude: [], proposalsSaved: [], proposalsClaimed: 0, ordersSaved: [], paypalOrders: [] };
let proposals = [];
// The seat assistant's model (Claude, Messages API), scripted: a create_seat_order call, then a reply.
const claudeMessage = (content, stopReason) => ({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: stopReason, usage: { input_tokens: 100, output_tokens: 20 } });
const claudeReplies = [
  claudeMessage([{ type: 'tool_use', id: 'toolu_1', name: 'create_seat_order', input: { quantity: 12, class_name: 'Fall class' } }], 'tool_use'),
  claudeMessage([{ type: 'text', text: 'Ready to order 12 seats at USD 49.00 each, USD 588.00 total. Click Confirm to continue to PayPal.' }], 'end_turn'),
];

// Outside services for the server side. Anything else is a test failure.
async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1' || hostname === 'localhost') return originalFetch(url, options);
  if (hostname === 'example.supabase.co') {
    if (pathname === '/auth/v1/user') {
      calls.auth.push(options.headers.Authorization);
      return options.headers.Authorization === 'Bearer instructor-token' ? Response.json({ id: INSTRUCTOR }) : Response.json({}, { status: 401 });
    }
    if (pathname === '/rest/v1/agent_actions') return new Response(null, { status: 201 });
    if (pathname === '/rest/v1/seat_proposals') {
      if (options.method === 'POST') {
        const row = JSON.parse(options.body);
        calls.proposalsSaved.push(row);
        proposals.push(row);
        return new Response(null, { status: 201 });
      }
      const id = searchParams.get('id')?.replace(/^eq\./, '');
      const userId = searchParams.get('user_id')?.replace(/^eq\./, '');
      const matched = proposals.filter((row) => row.id === id && (!userId || row.user_id === userId));
      if (options.method === 'DELETE') {
        calls.proposalsClaimed += matched.length;
        proposals = proposals.filter((row) => !matched.includes(row));
      }
      return Response.json(matched);
    }
    if (pathname === '/rest/v1/paypal_orders') {
      if (options.method === 'POST') {
        calls.ordersSaved.push(JSON.parse(options.body));
        return new Response(null, { status: 201 });
      }
      return Response.json([{ paypal_order_id: 'ORDER-OLD', student_name: 'Fall class', quantity: 2, amount: 98, currency: 'USD', status: 'COMPLETED', created_at: '2026-10-30T10:00:00Z', paypal_payments: [{ capture_id: 'CAP-OLD', created_at: '2026-10-30T10:05:00Z' }] }]);
    }
  }
  if (hostname === 'api.anthropic.com' && pathname === '/v1/messages') {
    calls.claude.push(JSON.parse(options.body));
    const reply = claudeReplies.shift();
    if (!reply) throw new Error('No scripted Claude reply left');
    return Response.json(reply);
  }
  if (hostname === 'api-m.sandbox.paypal.com') {
    if (pathname === '/v1/oauth2/token') return Response.json({ access_token: 'sandbox-token', expires_in: 3600 });
    if (pathname === '/v2/checkout/orders' && options.method === 'POST') {
      calls.paypalOrders.push(JSON.parse(options.body));
      return Response.json({ id: ORDER_ID, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: APPROVAL_URL }] });
    }
  }
  throw new Error(`Unexpected server request to ${url}`);
}

test('the lead hands a seat request to the Seat agent, which calls /api/agent/chat and shows a Confirm bar that goes to PayPal', { timeout: 180_000 }, async () => {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    PAYPAL_CLIENT_ID: 'sandbox_test_client',
    PAYPAL_SECRET: 'sandbox_test_secret',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  });
  delete process.env.PAYPAL_BASE_URL;
  globalThis.fetch = fakeFetch;

  const { default: app } = await import('../server/app.js');
  const vite = await createViteServer({ configFile: false, logLevel: 'error', appType: 'mpa', server: { middlewareMode: true, hmr: { port: await freePort() } } });
  const server = express();
  server.use(app);
  server.use(vite.middlewares);
  const listener = server.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  const origin = `http://127.0.0.1:${listener.address().port}`;
  process.env.APP_BASE_URL = origin;
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // The Ask AI lead's model turns (the only browser-side fake): hand off to the Seat agent, then answer.
    const leadTurns = [];
    await page.route('**/api/studio-ai/chat', async (route) => {
      const body = route.request().postDataJSON();
      const instructions = body.messages.find((message) => message.role === 'system')?.content ?? '';
      if (!/You are the Orchestrator/.test(instructions)) throw new Error('Only the lead should call the model in this test.');
      leadTurns.push(body);
      if (leadTurns.length === 1) {
        return route.fulfill({ json: { finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-seat', type: 'function', function: { name: 'delegate_to', arguments: JSON.stringify({ type: { id: 'seat' }, instructions: 'Prepare an order for 12 seats for the Fall class.' }) } }] } } });
      }
      return route.fulfill({ json: { finish_reason: 'stop', message: { role: 'assistant', content: 'The Seat agent prepared 12 seats for USD 588.00; click Confirm to pay.' } } });
    });
    // PayPal's approval page, so following the approval link lands somewhere checkable.
    await page.route('https://www.sandbox.paypal.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>PayPal Sandbox</title>Approve' }));

    await page.goto(`${origin}/e2e/seat-agent/index.html`);
    await page.getByRole('button', { name: 'Ask AI' }).click();
    const input = page.locator('textarea.ag-studio-ai-assistant-textarea');
    await input.waitFor({ timeout: 60_000 });
    await input.fill('Buy 12 seats for my Fall class');
    await page.locator('button.ag-studio-ai-assistant-send-button').click();

    // Confirm bar appears with the server-priced proposal.
    const bar = page.getByRole('group', { name: 'Seat order awaiting confirmation' });
    await bar.waitFor({ timeout: 60_000 });
    assert.match(await bar.innerText(), /12 seats · Fall class · USD 49\.00 each · USD 588\.00 total/);
    await page.getByText('The Seat agent prepared 12 seats').waitFor({ timeout: 30_000 });

    // Handoff: the lead offered "seat" as a delegate_to target and received the Seat agent's summary.
    const delegateTool = leadTurns[0].tools.find((tool) => tool.function.name === 'delegate_to');
    assert.match(JSON.stringify(delegateTool.function.parameters), /"seat"/);
    assert.match(leadTurns[0].messages.find((message) => message.role === 'system').content, /hand off to the Seat agent/);
    const handoffResult = leadTurns[1].messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call-seat');
    assert.match(handoffResult.content, /Ready to order 12 seats at USD 49\.00 each, USD 588\.00 total\..*nothing has been ordered or paid/);
    assert.match(await page.locator('.ag-studio-ai-scroll-content').innerText(), /Delegated to Seat agent/);

    // The real /api/agent/chat ran: signed-in token checked, the lead's instruction reached the
    // seat assistant's model, and the proposal was stored for this instructor.
    assert.ok(calls.auth.includes('Bearer instructor-token'));
    assert.equal(calls.claude.length, 2);
    assert.equal(calls.claude[0].model, 'claude-sonnet-5-5');
    assert.deepEqual(calls.claude[0].messages.filter((message) => message.role === 'user').map((message) => message.content), ['Prepare an order for 12 seats for the Fall class.']);
    assert.equal(calls.proposalsSaved.length, 1);
    assert.deepEqual([calls.proposalsSaved[0].user_id, calls.proposalsSaved[0].quantity, calls.proposalsSaved[0].class_name], [INSTRUCTOR, 12, 'Fall class']);
    assert.equal(calls.paypalOrders.length, 0, 'nothing is ordered before Confirm');

    // Confirm: the existing confirm endpoint creates the PayPal Sandbox order, then the page goes to PayPal.
    await page.getByRole('button', { name: 'Confirm and pay with PayPal' }).click();
    await page.waitForURL(APPROVAL_URL, { timeout: 30_000 });
    assert.equal(calls.proposalsClaimed, 1);
    assert.equal(calls.paypalOrders.length, 1);
    assert.equal(calls.paypalOrders[0].purchase_units[0].amount.value, '588.00');
    assert.deepEqual([calls.ordersSaved[0].paypal_order_id, calls.ordersSaved[0].user_id, calls.ordersSaved[0].quantity], [ORDER_ID, INSTRUCTOR, 12]);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => listener.close(resolve));
    await vite.close();
    globalThis.fetch = originalFetch;
  }
});
