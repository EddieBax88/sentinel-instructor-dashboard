// Times one Ask AI question end to end, per model turn, without a browser window or sign-in.
//
//   npm run time:ask-ai
//   npm run time:ask-ai -- "Add a column chart of revenue by class."
//
// Runs the real Instructor analytics view (AG Studio, its agents, and this app's adapter) in
// headless Chromium. Each turn the adapter posts is built by the same proxy code as the app
// (server/studioAi.js) and sent to NVIDIA with NVIDIA_API_KEY from .env; orders are sample data.
// Prints one row per turn and the total, and saves a screenshot to logs/ask-ai-timing.png.
// Needs Playwright's Chromium once: npx playwright install chromium
// Stops after 5 minutes (TIMEOUT_MIN to change), prints the turns that finished, and exits 1.

import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { AGENT_MODEL } from '../server/config.js';
import { nvidiaClient } from '../server/nvidia.js';
import { buildNvidiaRequest, describeTurn, sanitizeCompletion } from '../server/studioAi.js';

const QUESTION = process.argv[2] || 'Add a pie chart of seats unlocked vs pending.';
const HARD_TIMEOUT_MS = (Number(process.env.TIMEOUT_MIN) || 5) * 60_000;
const IDLE_CONFIRM_MS = 4000;

const order = (id, className, status, seats, orderDate, capturedDate = null) => {
  const amount = seats * 49;
  const unlocked = status === 'Unlocked';
  return {
    orderId: id, className, status, currency: 'USD', seats,
    seatsUnlocked: unlocked ? seats : 0, seatsPending: unlocked ? 0 : seats,
    amount, revenue: unlocked ? amount : 0, pendingAmount: unlocked ? 0 : amount,
    orderDate, capturedDate: unlocked ? capturedDate ?? orderDate : null,
  };
};
const SAMPLE = {
  classSize: 30,
  orders: [
    order('SAMPLE-1', 'Fall class', 'Unlocked', 12, '2026-10-20'),
    order('SAMPLE-2', 'Fall class', 'Pending', 30, '2026-10-22'),
    order('SAMPLE-3', 'Spring class', 'Unlocked', 1, '2026-10-24'),
    order('SAMPLE-4', 'Spring class', 'Unlocked', 8, '2026-10-26', '2026-10-27'),
    order('SAMPLE-5', 'Evening class', 'Pending', 5, '2026-10-28'),
  ],
};

const client = nvidiaClient('the timing harness');
const turns = [];
let questionStarted = 0;
let vite;
let browser;
let timedOut = false;

const hardTimeout = setTimeout(async () => {
  timedOut = true;
  process.exitCode = 1;
  console.log(`\n\nTIMED OUT after ${HARD_TIMEOUT_MS / 60_000} min. Turns that finished:`);
  report(null);
  const closing = Promise.allSettled([browser?.close(), vite?.close()]);
  await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 5000))]);
  process.exit(1);
}, HARD_TIMEOUT_MS);

vite = await createServer({ configFile: false, logLevel: 'error', server: { port: 0, host: '127.0.0.1', forwardConsole: false } });
await vite.listen();
const url = `${vite.resolvedUrls.local[0]}scripts/ask-ai-harness/index.html`;
browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (error) => console.error('page error:', error.message));

  await page.route('**/api/analytics/orders', (route) => route.fulfill({ json: SAMPLE }));
  await page.route('**/api/studio-ai/chat', async (route) => {
    const sentAt = performance.now();
    try {
      const nvidiaRequest = buildNvidiaRequest(route.request().postDataJSON());
      const completion = await client.chat.completions.create(nvidiaRequest, { timeout: 180_000, maxRetries: 0 });
      const latencyMs = Math.round(performance.now() - sentAt);
      turns.push({ startS: (sentAt - questionStarted) / 1000, ...describeTurn(nvidiaRequest, completion, latencyMs) });
      process.stdout.write('.');
      await route.fulfill({ json: sanitizeCompletion(completion) });
    } catch (error) {
      turns.push({ startS: (sentAt - questionStarted) / 1000, agent: '?', latencyMs: Math.round(performance.now() - sentAt), error: `${error.status ?? ''} ${error.message}`.slice(0, 100), tools: [] });
      await route.fulfill({ status: 502, json: { error: 'The analytics model request failed.' } });
    }
  });

  await page.goto(url);
  await page.getByRole('button', { name: 'Ask AI' }).click();
  const input = page.locator('textarea.ag-studio-ai-assistant-textarea');
  await input.waitFor({ timeout: 60_000 });
  await input.fill(QUESTION);

  console.log(`Model: ${AGENT_MODEL}\nQuestion: ${QUESTION}\n`);
  questionStarted = performance.now();
  await page.locator('button.ag-studio-ai-assistant-send-button').click();

  // Done when the progress bar has shown and then stayed hidden (the app hides it 1.5 s after the
  // last turn; this waits longer to be sure no further turn starts).
  const progress = page.locator('.ai-progress');
  await progress.waitFor({ state: 'visible', timeout: 30_000 });
  for (;;) {
    await progress.waitFor({ state: 'hidden', timeout: 0 });
    const hiddenAt = performance.now();
    await page.waitForTimeout(IDLE_CONFIRM_MS);
    if (await progress.isHidden()) {
      const totalS = (hiddenAt - questionStarted) / 1000 - 1.5;
      mkdirSync('logs', { recursive: true });
      await page.screenshot({ path: 'logs/ask-ai-timing.png' });
      report(totalS);
      break;
    }
  }
} catch (error) {
  // Closing the browser on timeout ends the waits above; that is not a second failure.
  if (!timedOut) throw error;
} finally {
  clearTimeout(hardTimeout);
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}

function report(totalS) {
  const cols = [['#', 3], ['start s', 8], ['agent', 9], ['latency s', 10], ['thinking tok', 13], ['output tok', 11], ['input tok', 10], ['tool called', 40]];
  console.log(`\n\n${cols.map(([name, width]) => name.padEnd(width)).join('')}`);
  turns.forEach((turn, index) => {
    const cells = [
      index + 1, turn.startS.toFixed(1), turn.agent, (turn.latencyMs / 1000).toFixed(1),
      turn.error ? '-' : `${turn.thinkingEstimated ? '~' : ''}${turn.thinkingTokens}`,
      turn.outputTokens ?? '-', turn.inputTokens ?? '-',
      turn.error ? `ERROR ${turn.error}` : turn.tools.join(', ') || `(text, ${turn.finishReason})`,
    ];
    console.log(cells.map((cell, i) => String(cell).padEnd(cols[i][1])).join(''));
  });
  const modelS = turns.reduce((sum, turn) => sum + turn.latencyMs, 0) / 1000;
  const sum = (key) => turns.reduce((total, turn) => total + (turn[key] ?? 0), 0);
  const total = totalS === null ? 'not finished' : `${totalS.toFixed(1)} s`;
  const browserTime = totalS === null ? '-' : `${(totalS - modelS).toFixed(1)} s`;
  console.log(`\nTurns: ${turns.length}   Total: ${total}   Model time: ${modelS.toFixed(1)} s   Browser/tool time: ${browserTime}`);
  console.log(`Tokens: thinking ${sum('thinkingTokens')}${turns.some((turn) => turn.thinkingEstimated) ? ' (~ = estimated from reasoning text)' : ''}, output ${sum('outputTokens')}, input ${sum('inputTokens')}`);
  if (totalS !== null) console.log('Screenshot: logs/ask-ai-timing.png');
}
