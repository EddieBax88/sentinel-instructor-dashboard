// Headless browser test of the three themes on the real dashboard (src/App.jsx) against the real
// Express app, with Supabase faked on the server and a seeded browser session. Checks the seat
// header, the status pills, the switch (persisted in localStorage, applied before first paint), and
// that AG Studio's charts follow the theme: the active theme's chart-1 hex must appear on the chart
// canvas and the previous theme's must not. Screenshots go to e2e/shots (gitignored).
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
  { paypal_order_id: 'ORDER-12', user_id: INSTRUCTOR, student_name: 'Fall class', quantity: 12, amount: 588, currency: 'USD', status: 'REFUNDED', created_at: '2026-10-29T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-12', created_at: '2026-10-29T18:05:00Z' }] },
];

async function fakeFetch(url, options = {}) {
  const { hostname, pathname } = new URL(url);
  if (hostname === '127.0.0.1' || hostname === 'localhost') return originalFetch(url, options);
  if (hostname === 'example.supabase.co') {
    if (pathname === '/auth/v1/user') return options.headers.Authorization === 'Bearer instructor-token' ? Response.json({ id: INSTRUCTOR }) : Response.json({}, { status: 401 });
    if (pathname === '/rest/v1/paypal_orders') return Response.json(ORDERS);
    if (pathname === '/rest/v1/paypal_webhook_events') return Response.json([]);
  }
  throw new Error(`Unexpected server request to ${url}`);
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

  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // The browser never reaches Supabase: the session is seeded, and anything else is a failure.
    await page.route('https://example.supabase.co/**', (route) => route.fulfill({ status: 500, body: 'unexpected browser request to Supabase' }));
    await page.route('**/api/studio-ai/chat', (route) => route.fulfill({ status: 500, json: { error: 'no model turns in this test' } }));
    await page.addInitScript(({ instructor }) => {
      if (!localStorage.getItem('sb-example-auth-token')) {
        localStorage.setItem('sb-example-auth-token', JSON.stringify({
          access_token: 'instructor-token', refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: instructor, aud: 'authenticated', role: 'authenticated', email: 'instructor@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
        }));
      }
    }, { instructor: INSTRUCTOR });

    // Default theme, no stored choice: applied before first paint.
    await page.goto(`${origin}/`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), DEFAULT_THEME);
    const counter = page.locator('.seat-counter');
    await counter.getByText('30 awaiting payment').waitFor({ timeout: 60_000 });
    assert.match((await counter.innerText()).replace(/\s+/g, ' '), /SEATS REMAINING 23 \/ 30 30 awaiting payment/);
    await page.getByText("Each seat unlocks Sentinel's NEC exam prep: the 5-Step Method on the 2026 NEC.").waitFor();
    assert.deepEqual(await page.locator('.table-block').first().locator('.ag-header-cell-text').evaluateAll((cells) => cells.map((cell) => cell.textContent)), ['CLASS', 'COHORT', 'SEATS', 'CAPTURE ID', 'AMOUNT', 'PAYMENT STATUS']);

    // Status pills in the ledger grid: completed green, awaiting payment amber, refunded red.
    const statusCells = page.locator('.table-block').first().locator('.status-cell');
    await statusCells.first().waitFor({ timeout: 30_000 });
    const pills = await statusCells.evaluateAll((cells) => cells.map((cell) => [cell.textContent, cell.className]));
    assert.deepEqual(pills.sort(), [['AWAITING PAYMENT', 'status-cell status-pending'], ['COMPLETED', 'status-cell status-completed'], ['REFUNDED', 'status-cell status-refunded']]);

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
    await browser.close();
    await new Promise((resolve) => listener.close(resolve));
    await vite.close();
    globalThis.fetch = originalFetch;
  }
});
