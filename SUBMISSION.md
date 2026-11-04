# Devpost submission pack

Paste-ready fields for the PayPal AI Hackathon entry. Check the live URL and the test counts before pasting (HANDOFF.md has the latest).

## Project name

Sentinel Instructor Dashboard

## Tagline

Instructors buy, track and refund exam-prep class seats by asking. Every dollar moves only after a human clicks Confirm.

## Write-up

### The problem

In fiscal year 2025, 1,390 of 5,050 Texas journeyman electrician exam attempts passed, a 27.52% pass rate ([TDLR exam statistics](https://www.tdlr.texas.gov/electricians/elecExamStats2025.htm)). Texas adopted the 2026 National Electrical Code as the state electrical code effective September 1, 2026 ([TDLR rule adoption](https://www.tdlr.texas.gov/news/rulemaking/2026/09/01/commission-adopts-rules-12/)), so instructors are re-teaching on a new edition at the same time. Instructors buy class seats in bulk for apprentices and journeyman candidates, and the buying, bookkeeping and refunds get in the way of teaching.

### What it does

An instructor signs in, asks for seats in plain English ("Buy 12 seats for my fall class"), sees a server-priced proposal, clicks Confirm, pays through PayPal Sandbox, and watches the seats unlock only after PayPal confirms the capture. Each seat unlocks Sentinel's NEC exam prep: the 5-Step Method on the 2026 NEC. The same assistant can propose a refund of the most recent paid order; a Confirm bar shows the capture ID and amount, and only that click issues the refund. A verified webhook then revokes the seats. The ledger, a live PayPal events drawer and an AG Studio analytics report update as it happens, and a "Reset demo data" action puts the instructor's own sandbox data back to zero.

### How PayPal and AI are used

- **Orders v2 and Payments v2.** Seat orders are created with `POST /v2/checkout/orders` and captured on return with `POST /v2/checkout/orders/{id}/capture`. Refunds call the Captures Refund API, `POST /v2/payments/captures/{id}/refund`, always for the recorded capture amount, with a fixed `PayPal-Request-Id` so a repeated click cannot refund twice.
- **Verified webhooks.** `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` are verified with PayPal's postback check on the raw request body. A capture grants seats through an idempotent Postgres function; a full refund revokes them through its counterpart; a partial refund is recorded only. Every verified event is shown in the PayPal events drawer.
- **Two AI surfaces, one money path.** The seat assistant (Claude Sonnet 5.5 through the Anthropic Messages API, with tool use) can only report pricing, report availability, prepare an order proposal or prepare a refund proposal. It cannot create a PayPal order, capture or refund: those endpoints are reached only by the instructor's Confirm click, and the server re-checks the signed-in user, the price and the capture ownership on every call. Prices, quantity limits and the sandbox host are fixed on the server.
- **Why not the PayPal Agent Toolkit for the refund.** `@paypal/agent-toolkit` offers `create_refund`, but it is built for model-invoked tool calling, pulls in a second model SDK, LangChain and an MCP server, and chooses sandbox versus live from its own context. The dashboard calls the same Captures Refund API directly, behind its sandbox-only guard and a human Confirm.

### How AG Studio is used

- **Instructor analytics is an AG Studio report** over the signed-in instructor's own orders: revenue and seat KPIs, seats ordered by day, order value and revenue by day, a by-class grid, and three custom widgets (Revenue tile, Seat progress, Class fill).
- **A custom Seat agent sits beside Studio's built-in agents.** Studio's lead agent hands any seat request ("Buy 5 seats for the fall class") to it with `delegate_to`; the Seat agent calls the dashboard's seat assistant, shows the reply in the Ask AI chat, places the proposal in a Confirm bar above the report, and reports back with `complete_task`. Ask AI runs through a sign-in-only server proxy that holds the model key and refuses any non-Studio tool. Ask AI runs on Claude Sonnet 5.5, chosen after a live comparison with Claude Haiku 5.5 on tool-call validity. The seat assistant runs on the same model and effort: it started on NVIDIA's free hosted endpoint, which stalled for 300 seconds on Nov 4, so it was moved to Claude and every model call now has a hard timeout that ends as a clean error.
- **Three themes, one source of truth.** Black & Safety-Yellow (default), Industrial and Light mirror sentinellearning.com's oklch token sets. A 3-segment switcher in the top bar persists the choice and an inline script applies it before first paint. Studio follows the switch live: its style sensor sees the foreground and background change and re-themes every widget and chart.
- **A finding worth sharing.** AG Studio resolves theme colours in JavaScript and converts only `rgb()` and `color(srgb)` values for AG Charts and for its widget, canvas and grid backgrounds. With oklch tokens those fell back to Studio's defaults. The dashboard generates sRGB hex twins of every colour token per theme (`src/theme/themes.js`, `scripts/build-theme-css.mjs`) and points the Studio theme at those. Unit tests enforce WCAG AA contrast for every text pair in all three themes, and a headless Chromium test samples the chart canvas to prove each theme's palette is drawn.

### What's next

- Class rosters: seats assigned to named students, with readiness pulled from the exam-prep product.
- Instructor invoices through PayPal Invoicing for schools that pay by purchase order.

## Built With

`node.js` `express` `react` `vite` `supabase` `postgresql` `paypal-orders-api` `paypal-payments-api` `paypal-webhooks` `ag-studio` `ag-grid` `ag-charts` `anthropic` `claude` `playwright` `vercel`

## Links

- Hosted demo: https://sentinel-hackathon-demo-mu.vercel.app (PayPal Sandbox only; create an account on the Overview page)
- Repository: https://github.com/EddieBax88/sentinel-instructor-dashboard
- Demo video: (add the link once recorded; the click path is in DEMO-SCRIPT.md)

## Nov 5 early check

- [ ] **LICENSE visible in GitHub About.** `LICENSE` (MIT) is at the repo root on `main`, so the About box shows "MIT license". If it does not, confirm the file is on the default branch and named exactly `LICENSE`.
- [ ] **README on the default branch.** The judged README is the one on `main`. PR #1 (this branch into `main`) must be merged, or the default branch switched, before judging.
- [ ] **.env.example complete.** Every variable the server reads is listed: `PORT`, `APP_BASE_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_BASE_URL`, `PAYPAL_WEBHOOK_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `STUDIO_AI_MODEL`, `STUDIO_AI_TIMING`, plus `NODEJS_HELPERS` (Vercel) and `VERCEL_GIT_COMMIT_SHA` (set by Vercel) as comments, and `NVIDIA_API_KEY` under "Scripts only" (the probe and timing scripts; the app never reads it). Re-check with: `grep -rhoE "process\.env\.[A-Z_]+" server api scripts src | sort -u`.
- [ ] **No secrets in the tree or history.** Run `git grep -nE "(sk-ant-|sk-live|AIza|-----BEGIN|nvapi-|eyJhbGciOi)" -- . ':!package-lock.json'` on the branch; the only hit must be the fake test key `sk-ant-test-key-that-must-never-reach-the-browser` in `server/studioAi.test.js` and `e2e/dashboard.test.mjs` (`e2e/seatAgent.test.mjs` and `e2e/layout.test.mjs` use the plain `test-anthropic-key`). `.env` is gitignored and was never committed (`git log --all -- .env` is empty).
- [ ] **Hosted demo answers.** `curl https://sentinel-hackathon-demo-mu.vercel.app/api/health` returns `{"status":"ok","environment":"sandbox-only","commit":"<sha of the deployed commit>"}`.
- [ ] **Tests green on a clean clone.** `npm ci && npm test && npm run test:browser` (173 unit tests, 6 browser tests as of Nov 4).
- [ ] **Video under 3 minutes**, recorded from DEMO-SCRIPT.md, uploaded, link pasted above.
- [ ] **Owner decisions in HANDOFF.md resolved** or consciously deferred: refund migration applied, `PAYMENT.CAPTURE.REFUNDED` on the webhook subscription, the agent-actions migration applied, judge test account.
