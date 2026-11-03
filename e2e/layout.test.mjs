// Layout checks of the real dashboard at full-screen widths, in every theme, against the real
// Express app with Supabase faked on the server and a seeded browser session:
// - every status pill contains its text (no overflow, even padding, centred text);
// - ledger tables fit their rows (no empty box under a single row);
// - Card 01's class name is prefilled from the newest ledger order and never carries the sign-in
//   email (a fresh input, not the reused email field);
// - the sidebar has exactly two nav links plus the company link;
// - the "Seats unlocked vs pending" numbers share one baseline;
// - no header in the "Orders by class" grid is truncated.
//
//   npm run test:browser   (LAYOUT_DEBUG=1 prints the measurements)

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import express from 'express';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { STORAGE_KEY, THEME_ORDER } from '../src/theme/themes.js';

const INSTRUCTOR = '00000000-0000-4000-8000-00000000000b';
const WIDTHS = [1440, 1920];
const debug = (label, value) => { if (process.env.LAYOUT_DEBUG) console.log(label, JSON.stringify(value)); };
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const originalFetch = globalThis.fetch;
const freePort = () => new Promise((resolve) => {
  const probe = createNetServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// One order per ledger status, so every pill variant renders. The newest is "fall class" (stored
// lower-case; the ledger shows "Fall class"). The pending order's long class name makes the first
// column of the analytics grid wide, which is what left the other headers no room.
const ORDERS = [
  { paypal_order_id: 'ORDER-7', user_id: INSTRUCTOR, student_name: 'Fall class', quantity: 7, amount: 343, currency: 'USD', status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-7', created_at: '2026-10-27T18:05:00Z' }] },
  { paypal_order_id: 'ORDER-30', user_id: INSTRUCTOR, student_name: 'Spring class, journeyman exam prep evening section', quantity: 30, amount: 1470, currency: 'USD', status: 'PENDING', created_at: '2026-10-28T18:00:00Z', paypal_payments: [] },
  { paypal_order_id: 'ORDER-12', user_id: INSTRUCTOR, student_name: 'fall class', quantity: 12, amount: 588, currency: 'USD', status: 'REFUNDED', created_at: '2026-10-29T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-12', created_at: '2026-10-29T18:05:00Z' }] },
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

async function startDashboard() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    PAYPAL_CLIENT_ID: 'sandbox_test_client',
    PAYPAL_SECRET: 'sandbox_test_secret',
    NVIDIA_API_KEY: 'test-nvidia-key',
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

  const openPage = async (width) => {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('https://example.supabase.co/**', (route) => route.fulfill({ status: 500, body: 'unexpected browser request to Supabase' }));
    await page.addInitScript(({ instructor }) => {
      if (!localStorage.getItem('sb-example-auth-token')) {
        localStorage.setItem('sb-example-auth-token', JSON.stringify({
          access_token: 'instructor-token', refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: instructor, aud: 'authenticated', role: 'authenticated', email: 'instructor@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
        }));
      }
    }, { instructor: INSTRUCTOR });
    return { page, pageErrors };
  };
  const stop = async () => {
    await browser.close();
    await new Promise((resolve) => listener.close(resolve));
    await vite.close();
    globalThis.fetch = originalFetch;
  };
  return { origin, openPage, stop };
}

// Every status pill on the overview: its text fits inside the pill, the pill fits inside its grid
// cell, the padding is even and the text centred.
const PILL_METRICS = () => [...document.querySelectorAll('.table-block .status-cell')].map((pill) => {
  const style = getComputedStyle(pill);
  const box = pill.getBoundingClientRect();
  const cell = pill.closest('.ag-cell').getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(pill);
  const text = range.getBoundingClientRect();
  return {
    text: pill.textContent,
    overflow: pill.scrollWidth - pill.clientWidth,
    textInside: text.left >= box.left - 0.5 && text.right <= box.right + 0.5,
    insideCell: box.left >= cell.left - 0.5 && box.right <= cell.right + 0.5,
    lines: Math.round(box.height / parseFloat(style.lineHeight)),
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
    textAlign: style.textAlign,
    leftGap: Math.round(text.left - box.left),
    rightGap: Math.round(box.right - text.right),
  };
});

// Each ledger grid's height against its header plus rows.
const TABLE_METRICS = () => [...document.querySelectorAll('.table-block')].map((block) => {
  const root = block.querySelector('.ag-root-wrapper');
  if (!root) return null;
  const header = root.querySelector('.ag-header').getBoundingClientRect().height;
  const byIndex = new Map([...root.querySelectorAll('.ag-row')].map((row) => [row.getAttribute('row-index'), row]));
  const rows = [...byIndex.values()];
  const rowsHeight = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
  return { title: block.querySelector('h3').textContent, rows: rows.length, height: root.getBoundingClientRect().height, needed: header + rowsHeight };
}).filter(Boolean);

const SEAT_KPI_METRICS = () => {
  const items = [...document.querySelectorAll('.studio-seats dl > div')];
  return items.map((item) => {
    const dt = item.querySelector('dt');
    const dd = item.querySelector('dd');
    const range = document.createRange();
    range.selectNodeContents(dd);
    // The baseline of the number: the bottom of its text box less the font's descent is the same
    // for equal fonts, so comparing text-box bottoms compares baselines.
    return { label: dt.textContent, value: dd.textContent, labelLines: dt.getClientRects().length && Math.round(dt.getBoundingClientRect().height / parseFloat(getComputedStyle(dt).lineHeight || '12')), numberBottom: range.getBoundingClientRect().bottom };
  });
};

// Header truncation at sub-pixel precision: scrollWidth rounds, but AG Grid's ellipsis appears as
// soon as the text is a fraction of a pixel wider than its box. Each word is measured on its own
// (a wrapped header may break between words, never inside one), and the whole header must fit
// inside the header cell and the grid's visible width.
const GRID_HEADER_METRICS = () => {
  const viewport = document.querySelector('.analytics-canvas .ag-header-viewport, .analytics-canvas .ag-header').getBoundingClientRect();
  return [...document.querySelectorAll('.analytics-canvas .ag-header-cell')].map((cell) => {
    const text = cell.querySelector('.ag-header-cell-text');
    const style = getComputedStyle(text);
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${style.font};letter-spacing:${style.letterSpacing}`;
    document.body.append(probe);
    const widthOf = (value) => { probe.textContent = value; return probe.getBoundingClientRect().width; };
    const wraps = style.whiteSpace !== 'nowrap';
    const needed = wraps ? Math.max(...text.textContent.split(/\s+/).map(widthOf)) : widthOf(text.textContent);
    probe.remove();
    const box = text.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    return {
      text: text.textContent,
      clippedX: needed - box.width,
      clippedY: Math.max(text.scrollHeight - text.clientHeight, box.bottom - cellBox.bottom),
      offGrid: Math.max(cellBox.right - viewport.right, viewport.left - cellBox.left),
    };
  });
};

test('Card 01 class name: a fresh input, prefilled from the newest order, never the sign-in email', { timeout: 120_000 }, async () => {
  const { origin, openPage, stop } = await startDashboard();
  try {
    const { page, pageErrors } = await openPage(1440);
    // Hold the Supabase config so the sign-in form renders first, as it does on a real page load.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/supabase-config', async (route) => { await held; await route.continue(); });
    await page.goto(`${origin}/`);
    const email = page.locator('#account-email');
    await email.waitFor({ timeout: 60_000 });
    // A browser password manager fills the email field without telling React. Mark the node.
    await email.evaluate((node) => { node.__signInField = true; });
    release();
    const className = page.locator('#class-name');
    await className.waitFor({ timeout: 60_000 });
    assert.equal(await className.evaluate((node) => node.__signInField === true), false, 'the class name input must not be the reused email input');
    await page.waitForFunction(() => document.querySelector('#class-name').value !== '', null, { timeout: 30_000 });
    assert.equal(await className.inputValue(), 'Fall class');
    assert.equal(await className.getAttribute('placeholder'), 'Class name');
    // The 3-second ledger poll must not overwrite what the instructor types.
    await className.fill('');
    await page.waitForTimeout(3500);
    assert.equal(await className.inputValue(), '');
    assert.deepEqual(pageErrors, []);
  } finally {
    await stop();
  }
});

test('overview and analytics layout at 1440 and 1920 px in every theme', { timeout: 600_000 }, async () => {
  const { origin, openPage, stop } = await startDashboard();
  try {
    for (const width of WIDTHS) {
      const { page, pageErrors } = await openPage(width);
      for (const theme of THEME_ORDER) {
        const where = `${theme} @ ${width}px`;
        await page.goto(`${origin}/`);
        await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, theme]);
        await page.reload();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);

        // Sidebar: exactly Overview and Instructor analytics, plus the company link.
        assert.deepEqual(await page.locator('.rail .rail-link').evaluateAll((links) => links.map((link) => [link.textContent, link.getAttribute('href')])), [['Overview', '#overview'], ['Instructor analytics', '#analytics']], where);
        assert.deepEqual(await page.locator('.rail a.rail-footer').evaluateAll((links) => links.map((link) => link.textContent)), ['A Sentinel Learning Inc. product']);

        // Status pills, all three variants in both pill tables.
        await page.waitForFunction(() => document.querySelectorAll('.table-block .status-cell').length === 6, null, { timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        const pills = await page.evaluate(PILL_METRICS);
        debug(`pills ${where}`, pills);
        debug(`tables ${where}`, await page.evaluate(TABLE_METRICS));
        assert.deepEqual(pills.map((pill) => pill.text).sort(), ['AWAITING PAYMENT', 'COMPLETED', 'Payment pending', 'REFUNDED', 'Seat revoked', 'Seat unlocked'], where);
        for (const pill of pills) {
          const label = `${pill.text} pill, ${where}`;
          assert.ok(pill.overflow <= 0, `${label}: text overflows by ${pill.overflow}px`);
          assert.ok(pill.textInside, `${label}: text sticks out of the pill`);
          assert.ok(pill.insideCell, `${label}: pill is clipped by its cell`);
          assert.equal(pill.lines, 1, `${label}: wraps`);
          assert.equal(pill.paddingLeft, pill.paddingRight, `${label}: uneven padding`);
          assert.equal(pill.textAlign, 'center', `${label}: text not centred`);
          assert.ok(Math.abs(pill.leftGap - pill.rightGap) <= 1, `${label}: text off-centre (${pill.leftGap} vs ${pill.rightGap})`);
        }

        // Ledger tables fit their rows (Class seats has one row).
        const tables = await page.evaluate(TABLE_METRICS);
        assert.deepEqual(tables.map((table) => [table.title, table.rows]), [['Transactions', 3], ['Class seats', 1], ['Student readiness', 3]], where);
        for (const table of tables) assert.ok(table.height <= table.needed + 4, `${table.title}, ${where}: ${table.height}px tall for ${table.needed}px of header and rows`);
        await page.screenshot({ path: `${SHOTS}layout-overview-${theme}-${width}.png`, fullPage: true });

        // Analytics.
        await page.goto(`${origin}/#analytics`);
        await page.locator('.studio-seats dd').first().waitFor({ timeout: 90_000 });
        await page.waitForFunction(() => document.querySelectorAll('.analytics-canvas .ag-cell[col-id="orders.className"]').length >= 2, null, { timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        // Studio sizes the grid columns after its first data render; give it a frame to settle.
        await page.waitForTimeout(500);

        const kpis = await page.evaluate(SEAT_KPI_METRICS);
        debug(`kpis ${where}`, kpis);
        debug(`headers ${where}`, await page.evaluate(GRID_HEADER_METRICS));
        assert.deepEqual(kpis.map((kpi) => kpi.label), ['Unlocked', 'Awaiting payment', 'Class size', 'Still to fill'], where);
        assert.deepEqual(kpis.map((kpi) => kpi.value), ['7', '30', '30', '23'], where);
        const bottoms = kpis.map((kpi) => kpi.numberBottom);
        assert.ok(Math.max(...bottoms) - Math.min(...bottoms) <= 0.5, `Seat KPI numbers off one baseline, ${where}: ${bottoms.join(', ')}`);
        const lines = kpis.map((kpi) => kpi.labelLines);
        assert.ok(lines.every((n) => n === 1) || new Set(lines).size === 1, `Seat KPI labels wrap unevenly, ${where}: ${lines.join(', ')}`);

        const headers = await page.evaluate(GRID_HEADER_METRICS);
        assert.deepEqual(headers.map((header) => header.text), ['Class', 'Seats Ordered', 'Seats Unlocked', 'Seats Pending', 'Revenue', 'Awaiting Payment'], where);
        for (const header of headers) {
          assert.ok(header.clippedX <= 0, `"${header.text}" header truncated by ${header.clippedX.toFixed(2)}px, ${where}`);
          assert.ok(header.clippedY <= 0, `"${header.text}" header clipped vertically by ${header.clippedY}px, ${where}`);
          assert.ok(header.offGrid <= 0.5, `"${header.text}" header runs ${header.offGrid}px past the grid, ${where}`);
        }
        await page.screenshot({ path: `${SHOTS}layout-analytics-${theme}-${width}.png`, fullPage: true });
      }
      assert.deepEqual(pageErrors, []);
      await page.close();
    }
  } finally {
    await stop();
  }
});

// At 1024px the PAYMENT STATUS column sits at its minimum width; this is where the old 150px minimum
// left a 118px content box for a 118.3px pill, so max-width clamped the pill under its text.
test('status pills fit at the narrowest desktop width, where the status column is at its minimum', { timeout: 120_000 }, async () => {
  const { origin, openPage, stop } = await startDashboard();
  try {
    const { page, pageErrors } = await openPage(1024);
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => document.querySelectorAll('.table-block .status-cell').length === 6, null, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    for (const pill of await page.evaluate(PILL_METRICS)) {
      assert.ok(pill.overflow <= 0 && pill.textInside && pill.insideCell && pill.lines === 1, `${pill.text} pill at 1024px: ${JSON.stringify(pill)}`);
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await stop();
  }
});
