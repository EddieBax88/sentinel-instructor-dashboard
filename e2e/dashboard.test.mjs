// Headless browser tests of the real dashboard (src/App.jsx) against the real Express app, with
// Supabase, NVIDIA and PayPal Sandbox faked on the server and a seeded browser session.
// 1. Themes: the seat header, status pills, judge chips, the switch (persisted in localStorage,
//    applied before first paint), and AG Studio following the theme: the active theme's chart-1 hex
//    must appear on the chart canvas and the previous theme's must not.
// 2. Agent-driven refund: the refund chip, the seat assistant's proposal, the Confirm gate, the
//    sandbox refund call, the ledger showing the order REFUNDED with its seats back, then the
//    demo reset behind its confirm dialog, deleting only this instructor's rows.
// Screenshots go to e2e/shots (gitignored).
//
//   npm run test:browser

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import express from 'express';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { chartTokens, DEFAULT_THEME, srgbTokens, STORAGE_KEY, THEME_ORDER } from '../src/theme/themes.js';
import { hexToRgb } from '../src/theme/oklch.js';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
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
const SHOTS = new URL('./shots/', import.meta.url).pathname;

// 7 unlocked, 30 awaiting payment, 12 refunded: the three states the seat math must handle.
const ORDERS = [
  { paypal_order_id: 'ORDER-7', user_id: INSTRUCTOR, student_name: 'Fall class', quantity: 7, amount: 343, currency: 'USD', status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-7', created_at: '2026-10-27T18:05:00Z' }] },
  { paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR, student_name: 'Spring class', quantity: 30, amount: 1470, currency: 'USD', status: 'PENDING', created_at: '2026-10-28T18:00:00Z', paypal_payments: [] },
  // Stored lower-case on purpose (the live table has both spellings): the UI must show it as "Fall class".
  { paypal_order_id: 'ORDER-12', user_id: INSTRUCTOR, student_name: 'fall class', quantity: 12, amount: 588, currency: 'USD', status: 'REFUNDED', created_at: '2026-10-29T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-12', created_at: '2026-10-29T18:05:00Z' }] },
];

const calls = { nvidia: [], refunds: [], revokes: [], actions: [], deletes: [] };
// The seat assistant's model, scripted: a refund request becomes a propose_refund call, then a reply.
const nvidiaReplies = [
  { choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'nv-1', type: 'function', function: { name: 'propose_refund', arguments: '{}' } }] } }] },
  { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'I can refund USD 343.00 for the 7 Fall class seats (capture CAP-7). Click Confirm to issue the refund.' } }] },
];

async function fakeFetch(url, options = {}) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === '127.0.0.1' || hostname === 'localhost') return originalFetch(url, options);
  if (hostname === 'example.supabase.co') {
    if (pathname === '/auth/v1/user') return options.headers.Authorization === 'Bearer instructor-token' ? Response.json({ id: INSTRUCTOR }) : Response.json({}, { status: 401 });
    if (options.method === 'DELETE') {
      // The demo reset: PostgREST deletes and returns only the filtered rows.
      const table = pathname.replace('/rest/v1/', '');
      calls.deletes.push({ table, filter: searchParams.get('user_id') });
      if (table === 'paypal_orders' && searchParams.get('user_id') === `eq.${INSTRUCTOR}`) {
        const removed = ORDERS.splice(0, ORDERS.length);
        return Response.json(removed.map((row) => ({ user_id: row.user_id })));
      }
      return Response.json([]);
    }
    if (pathname === '/rest/v1/paypal_orders') return Response.json(ORDERS);
    if (pathname === '/rest/v1/paypal_webhook_events') return Response.json([]);
    if (pathname === '/rest/v1/agent_actions') {
      calls.actions.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
    if (pathname === '/rest/v1/paypal_payments') {
      const id = searchParams.get('capture_id')?.replace(/^eq\./, '');
      const order = ORDERS.find((row) => row.paypal_payments[0]?.capture_id === id);
      return Response.json(order ? [{ capture_id: id, amount: order.amount, currency: order.currency, status: order.status === 'REFUNDED' ? 'REFUNDED' : 'COMPLETED', paypal_orders: order }] : []);
    }
    if (pathname === '/rest/v1/rpc/revoke_seat_access') {
      const body = JSON.parse(options.body);
      calls.revokes.push(body);
      const order = ORDERS.find((row) => row.paypal_order_id === body.p_order_id);
      if (order.status === 'REFUNDED') return Response.json('already_revoked');
      order.status = 'REFUNDED';
      return Response.json('revoked');
    }
  }
  if (hostname === 'integrate.api.nvidia.com' && pathname === '/v1/chat/completions') {
    calls.nvidia.push(JSON.parse(options.body));
    const reply = nvidiaReplies.shift();
    if (!reply) throw new Error('No scripted NVIDIA reply left');
    return Response.json(reply);
  }
  if (hostname === 'api-m.sandbox.paypal.com') {
    if (pathname === '/v1/oauth2/token') return Response.json({ access_token: 'sandbox-token', expires_in: 3600 });
    const refund = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(pathname);
    if (refund && options.method === 'POST') {
      calls.refunds.push({ captureId: refund[1], headers: options.headers, body: JSON.parse(options.body) });
      return Response.json({ id: `REF-${refund[1]}`, status: 'COMPLETED' }, { status: 201 });
    }
  }
  throw new Error(`Unexpected server request to ${url}`);
}

// The dashboard under test: real app, faked outside services, a seeded session in the browser.
async function startDashboard() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    PAYPAL_CLIENT_ID: 'sandbox_test_client',
    PAYPAL_SECRET: 'sandbox_test_secret',
    NVIDIA_API_KEY: 'test-nvidia-key',
    ANTHROPIC_API_KEY: 'sk-ant-test-key-that-must-never-reach-the-browser',
  });
  delete process.env.PAYPAL_BASE_URL;
  globalThis.fetch = fakeFetch;
  mkdirSync(SHOTS, { recursive: true });

  const { default: app } = await import('../server/app.js');
  const vite = await createViteServer({ configFile: false, logLevel: 'error', appType: 'spa', server: { middlewareMode: true, hmr: { port: await freePort() } } });
  const server = express();
  server.use(app);
  server.use(vite.middlewares);
  const listener = server.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  const origin = `http://127.0.0.1:${listener.address().port}`;
  process.env.APP_BASE_URL = origin;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // The browser never reaches Supabase: the session is seeded, and anything else is a failure.
  await page.route('https://example.supabase.co/**', (route) => route.fulfill({ status: 500, body: 'unexpected browser request to Supabase' }));
  await page.addInitScript(({ instructor }) => {
    if (!localStorage.getItem('sb-example-auth-token')) {
      localStorage.setItem('sb-example-auth-token', JSON.stringify({
        access_token: 'instructor-token', refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: instructor, aud: 'authenticated', role: 'authenticated', email: 'instructor@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
      }));
    }
  }, { instructor: INSTRUCTOR });
  const stop = async () => {
    await browser.close();
    await new Promise((resolve) => listener.close(resolve));
    await vite.close();
    globalThis.fetch = originalFetch;
  };
  return { page, origin, pageErrors, stop };
}

// Counts the distinct opaque colours on every AG Charts canvas inside the Studio canvas.
const CANVAS_COLOURS = () => {
  const seen = new Set();
  for (const canvas of document.querySelectorAll('.analytics-canvas canvas')) {
    const context = canvas.getContext('2d');
    if (!context || !canvas.width) continue;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 16) {
      if (data[i + 3] === 255) seen.add(`#${[data[i], data[i + 1], data[i + 2]].map((c) => c.toString(16).padStart(2, '0')).join('')}`);
    }
  }
  return [...seen];
};

const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('the three themes apply to the dashboard, persist, and re-colour AG Studio charts and the Ask AI panel', { timeout: 240_000 }, async () => {
  const { page, origin, pageErrors, stop } = await startDashboard();
  try {
    let modelCalls = 0;
    await page.route('**/api/studio-ai/chat', (route) => {
      modelCalls += 1;
      return route.fulfill({ status: 500, json: { error: 'no model turns in this test' } });
    });

    // Default theme, no stored choice: applied before first paint.
    await page.goto(`${origin}/`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), DEFAULT_THEME);
    const counter = page.locator('.seat-counter');
    await counter.getByText('30 awaiting payment').waitFor({ timeout: 60_000 });
    assert.match((await counter.innerText()).replace(/\s+/g, ' '), /SEATS REMAINING 23 \/ 30 30 awaiting payment/);
    await page.getByText("Each seat unlocks Sentinel's NEC exam prep: the 5-Step Method on the 2026 NEC.").waitFor();
    assert.deepEqual(await page.locator('.table-block').first().locator('.ag-header-cell-text').evaluateAll((cells) => cells.map((cell) => cell.textContent)), ['CLASS', 'COHORT', 'SEATS', 'CAPTURE ID', 'AMOUNT', 'PAYMENT STATUS']);
    // "fall class" and "Fall class" show as one spelling in the ledger.
    assert.deepEqual((await page.locator('.table-block').first().locator('.ag-cell[col-id="studentName"]').evaluateAll((cells) => cells.map((cell) => cell.textContent))).sort(), ['Fall class', 'Fall class', 'Spring class']);
    assert.equal(await page.locator('#class-name').getAttribute('placeholder'), 'Class name, e.g. Fall class');

    // Status pills in the ledger grid: completed green, awaiting payment amber, refunded red.
    const statusCells = page.locator('.table-block').first().locator('.status-cell');
    await statusCells.first().waitFor({ timeout: 30_000 });
    const pills = await statusCells.evaluateAll((cells) => cells.map((cell) => [cell.textContent, cell.className]));
    assert.deepEqual(pills.sort(), [['AWAITING PAYMENT', 'status-cell status-pending'], ['COMPLETED', 'status-cell status-completed'], ['REFUNDED', 'status-cell status-refunded']]);

    // Seat assistant chips fill the input and send nothing.
    const seatChips = page.getByRole('group', { name: 'Example seat requests' }).getByRole('button');
    assert.deepEqual(await seatChips.evaluateAll((buttons) => buttons.map((button) => button.textContent)), ['Buy 12 seats for my fall class', 'Buy 3 seats for the spring class', 'Refund my last seat order']);
    await seatChips.nth(1).click();
    assert.equal(await page.locator('#agent-input').inputValue(), 'Buy 3 seats for the spring class');
    assert.equal(await page.locator('.agent-log').count(), 0, 'a chip fills the input, it does not send');

    const switcher = page.getByRole('radiogroup', { name: 'Theme' });
    assert.deepEqual(await switcher.getByRole('radio').evaluateAll((buttons) => buttons.map((button) => button.textContent)), ['Black', 'Industrial', 'Light']);

    const seenChart1 = {};
    for (const name of THEME_ORDER) {
      await switcher.getByRole('radio', { name: name === 'black-yellow' ? 'Black' : name === 'industrial' ? 'Industrial' : 'Light' }).click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), name);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), name);
      const expected = chartTokens(name);
      assert.equal(await cssVar(page, '--chart-1'), expected['chart-1']);
      await page.screenshot({ path: `${SHOTS}overview-${name}.png`, fullPage: true });

      // Analytics: Studio renders the charts with this theme's palette.
      await page.goto(`${origin}/#analytics`);
      await page.locator('.analytics-canvas canvas').first().waitFor({ timeout: 90_000 });
      await page.waitForFunction((hex) => {
        const seen = new Set();
        for (const canvas of document.querySelectorAll('.analytics-canvas canvas')) {
          const context = canvas.getContext('2d');
          if (!context || !canvas.width) continue;
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < data.length; i += 16) if (data[i + 3] === 255) seen.add(`#${[data[i], data[i + 1], data[i + 2]].map((c) => c.toString(16).padStart(2, '0')).join('')}`);
        }
        return seen.has(hex);
      }, expected['chart-1'], { timeout: 60_000 });
      if (name === DEFAULT_THEME) {
        // Studio's by-class grid groups the lower-case row with "Fall class": two classes plus Total.
        await page.waitForFunction(() => document.querySelectorAll('.analytics-canvas .ag-cell[col-id="orders.className"]').length >= 2, null, { timeout: 60_000 });
        const classes = await page.locator('.analytics-canvas .ag-cell[col-id="orders.className"]').evaluateAll((cells) => cells.map((cell) => cell.textContent.trim()).filter(Boolean));
        assert.deepEqual([...new Set(classes)].sort(), ['Fall class', 'Spring class', 'Total']);
      }
      const colours = await page.evaluate(CANVAS_COLOURS);
      // Studio resolves widget, canvas and inner-grid colours in JavaScript: with oklch tokens they fell
      // back to white widgets and dark text. They must be this theme's card and foreground.
      const rgb = (hex) => `rgb(${hexToRgb(hex).join(', ')})`;
      const twins = srgbTokens(name);
      assert.equal(await page.locator('.ag-studio-layout-widget-container').first().evaluate((el) => getComputedStyle(el).backgroundColor), rgb(twins['srgb-card']), `${name} widget background`);
      assert.equal(await page.locator('.analytics-canvas .ag-row').first().evaluate((el) => getComputedStyle(el).backgroundColor), rgb(twins['srgb-card']), `${name} grid row background`);
      assert.equal(await page.locator('.analytics-canvas .ag-cell').first().evaluate((el) => getComputedStyle(el).color), rgb(twins['srgb-foreground']), `${name} grid cell text`);
      assert.ok(colours.includes(expected['chart-text']), `${name} chart text ${expected['chart-text']} not drawn on the canvas`);
      for (const [other, hex] of Object.entries(seenChart1)) {
        if (other !== name) assert.ok(!colours.includes(hex), `${other}'s chart-1 ${hex} still on the canvas under ${name}`);
      }
      seenChart1[name] = expected['chart-1'];
      await page.screenshot({ path: `${SHOTS}analytics-${name}.png`, fullPage: true });

      // Ask AI panel in this theme (no model turn is sent; the panel just opens).
      await page.getByRole('button', { name: 'Ask AI' }).click();
      const input = page.locator('textarea.ag-studio-ai-assistant-textarea');
      await input.waitFor({ timeout: 60_000 });
      // Judge chips sit under Studio's input, fill it, and send nothing.
      assert.equal(await input.evaluate((el) => getComputedStyle(el).color), rgb(twins['srgb-foreground']), `${name} Ask AI textarea text`);
      const askChips = page.locator('.ag-studio-ai-assistant-input').getByRole('group', { name: 'Example questions' }).getByRole('button');
      await askChips.first().waitFor({ timeout: 30_000 });
      assert.deepEqual(await askChips.evaluateAll((buttons) => buttons.map((button) => button.textContent)), ['Revenue by class as a column chart', 'Buy 5 seats for the fall class']);
      await askChips.nth(1).click();
      assert.equal(await input.inputValue(), 'Buy 5 seats for the fall class');
      assert.equal(modelCalls, 0, 'a chip fills the input, it does not send');
      await page.screenshot({ path: `${SHOTS}ask-ai-${name}.png`, fullPage: true });
      await page.goto(`${origin}/`);
      await page.locator('.seat-counter').waitFor({ timeout: 60_000 });
    }

    // The stored choice survives a reload and is applied before the bundle runs.
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'light');
    assert.deepEqual(pageErrors, []);
  } finally {
    await stop();
  }
});

test('the refund chip leads to a proposal, a Confirm gate, one sandbox refund, a REFUNDED ledger, and the reset clears it', { timeout: 180_000 }, async () => {
  const { page, origin, pageErrors, stop } = await startDashboard();
  try {
    await page.goto(`${origin}/`);
    const counter = page.locator('.seat-counter');
    await counter.getByText('30 awaiting payment').waitFor({ timeout: 60_000 });
    assert.match((await counter.innerText()).replace(/\s+/g, ' '), /SEATS REMAINING 23 \/ 30/);

    // The refund chip is shown (the refund endpoint ships) and fills the input.
    const chips = page.getByRole('group', { name: 'Example seat requests' }).getByRole('button');
    assert.deepEqual(await chips.evaluateAll((buttons) => buttons.map((button) => button.textContent)), ['Buy 12 seats for my fall class', 'Buy 3 seats for the spring class', 'Refund my last seat order']);
    await chips.nth(2).click();
    assert.equal(await page.locator('#agent-input').inputValue(), 'Refund my last seat order');
    assert.equal(calls.nvidia.length, 0);

    // Send: the assistant proposes the most recent paid capture; nothing is refunded yet.
    await page.getByRole('button', { name: 'Send' }).click();
    const bar = page.getByRole('group', { name: 'Refund awaiting confirmation' });
    await bar.waitFor({ timeout: 60_000 });
    assert.match((await bar.innerText()).replace(/\s+/g, ' '), /Capture CAP-7 · 7 seats · Fall class · USD 343\.00 full refund/);
    assert.equal(calls.nvidia.length, 2);
    assert.equal(calls.refunds.length, 0, 'nothing is refunded before Confirm');
    assert.equal(calls.revokes.length, 0);
    await page.screenshot({ path: `${SHOTS}refund-confirm.png`, fullPage: true });

    // Confirm: one Captures Refund call for the full amount, seats revoked, ledger updated.
    await page.getByRole('button', { name: 'Confirm refund' }).click();
    await page.getByText('Refund REF-CAP-7 issued for USD 343.00. 7 seats for Fall class revoked.').waitFor({ timeout: 30_000 });
    assert.equal(calls.refunds.length, 1);
    assert.equal(calls.refunds[0].captureId, 'CAP-7');
    assert.deepEqual(calls.refunds[0].body.amount, { value: '343.00', currency_code: 'USD' });
    assert.equal(calls.refunds[0].headers['PayPal-Request-Id'], 'sentinel-refund-CAP-7');
    assert.deepEqual(calls.revokes.map((call) => [call.p_user_id, call.p_capture_id, call.p_refund_id]), [[INSTRUCTOR, 'CAP-7', 'REF-CAP-7']]);
    assert.ok(calls.actions.some((row) => row.action === 'refund_proposed'));
    assert.ok(calls.actions.some((row) => row.action === 'refund_issued'));
    assert.equal(await bar.count(), 0, 'the Confirm bar closes');

    // The ledger (polled every 3 s) shows the order REFUNDED and its 7 seats back in remaining.
    await counter.locator('strong').getByText('30', { exact: false }).first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /SEATS REMAINING\s*30\s*\/\s*30/.test(document.querySelector('.seat-counter')?.innerText ?? ''), null, { timeout: 30_000 });
    // The grid re-renders a frame after the header, so wait for its pills rather than read once.
    await page.waitForFunction(() => {
      const pills = [...document.querySelector('.table-block')?.querySelectorAll('.status-cell') ?? []].map((cell) => cell.textContent).sort();
      return JSON.stringify(pills) === JSON.stringify(['AWAITING PAYMENT', 'REFUNDED', 'REFUNDED']);
    }, null, { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}refund-done.png`, fullPage: true });

    // Reset demo data: a confirm dialog first, then only this instructor's rows go, and the ledger empties.
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset demo data?' });
    await dialog.waitFor();
    assert.equal(calls.deletes.length, 0, 'opening the dialog deletes nothing');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(calls.deletes.length, 0, 'cancel deletes nothing');
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    await page.screenshot({ path: `${SHOTS}reset-confirm.png` });
    await dialog.getByRole('button', { name: 'Reset my demo data' }).click();
    await page.getByText('Demo data reset: 3 orders removed.').waitFor({ timeout: 30_000 });
    assert.deepEqual(calls.deletes.map((call) => call.table), ['user_entitlements', 'paypal_payments', 'paypal_orders', 'seat_proposals', 'paypal_webhook_events', 'agent_actions']);
    assert.ok(calls.deletes.every((call) => call.filter === `eq.${INSTRUCTOR}`), 'every delete is filtered to the signed-in instructor');
    await page.getByText('No seat orders yet.').waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /SEATS REMAINING\s*30\s*\/\s*30/.test(document.querySelector('.seat-counter')?.innerText ?? ''), null, { timeout: 30_000 });
    assert.equal(await page.locator('.seat-pill').count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await stop();
  }
});
