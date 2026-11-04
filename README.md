# Sentinel Instructor Dashboard

An instructor sells seats in an exam-prep class, confirms every purchase before money moves, and watches the ledger, PayPal events and analytics update live. Built for the PayPal AI Hackathon by [Sentinel Learning Inc.](https://www.sentinellearning.com), which teaches electricians to find answers in their own code book.

**Why this exists.** In fiscal year 2025, 1,390 of 5,050 Texas journeyman electrician exam attempts passed, a 27.52% pass rate ([TDLR exam statistics](https://www.tdlr.texas.gov/electricians/elecExamStats2025.htm)). Texas adopted the 2026 National Electrical Code as the state electrical code effective September 1, 2026 ([TDLR rule adoption](https://www.tdlr.texas.gov/news/rulemaking/2026/09/01/commission-adopts-rules-12/)), so instructors are re-teaching on a new edition. Instructors buy class seats in bulk, and the buying and bookkeeping gets in the way of teaching. This dashboard lets an instructor ask for seats in plain English, approve the exact amount, pay through PayPal, and see seats unlock only after PayPal confirms the capture.

**Hosted demo:** https://sentinel-hackathon-demo-mu.vercel.app (PayPal Sandbox only; no real money). Create an account on the Overview page, then buy a seat, or ask the seat assistant to prepare a multi-seat order.

## Architecture in 60 seconds

```
Instructor types "Buy 12 seats for my fall class"
   │
   ▼
Seat agent (server/agent.js, NVIDIA Nemotron via the openai SDK)
   calls get_seat_pricing / get_current_seats / create_seat_order
   → a PROPOSAL only: 12 × USD 49.00 = USD 588.00. Nothing is ordered.
   │
   ▼
Human Confirm (AgentPanel.jsx or the Confirm bar on Instructor analytics)
   POST /api/agent/proposals/:id/confirm → PayPal Orders v2 create → approval link
   │
   ▼
PayPal Sandbox approval → return to the app → POST /api/paypal/orders/:id/capture
   │
   ▼
Supabase ledger (paypal_orders, paypal_payments, user_entitlements)
   grant_seat_access(): locks the order row, checks amount = 49.00 × quantity,
   records the capture once, marks the order COMPLETED, activates the seat
   │
   ▼
Verified webhooks (server/webhook.js): PAYMENT.CAPTURE.COMPLETED is verified with
   PayPal's postback check on the raw body, then granted through the same function
   (a duplicate is a no-op) and recorded in paypal_webhook_events.
   PAYMENT.CAPTURE.REFUNDED: the capture is resolved from the refund's "up" link;
   a full refund calls revoke_seat_access() (order and payment REFUNDED, seat
   access deactivated when no completed order remains); a partial refund is
   recorded only
   │
   ▼
Live PayPal events drawer (EventDrawer.jsx) + Instructor analytics (AG Studio):
   KPIs, charts, Class fill, Orders by class; Ask AI on Anthropic Claude through a
   server proxy; a custom Seat agent sits beside Studio's built-in agents and hands
   seat requests back to the same propose-then-Confirm flow
```

- **Two AI surfaces, one money path.** The seat assistant on Overview and the Seat agent inside AG Studio's Ask AI both end at the same server-priced proposal and the same Confirm endpoint. No model can create an order or move money.
- **Server-side truth.** Price (USD 49.00 per seat), quantity limits (1 to 200 per order), the signed-in user (from the verified Supabase token, never from the request), and the sandbox host are all fixed on the server.
- **Idempotent grants and revokes.** Capture from the browser and the webhook race safely: the Postgres function records a capture once and returns early on a repeat. A full refund revokes once; a retried refund event answers "already revoked".

## How PayPal is used

- **Orders v2.** A confirmed proposal creates the order with `POST /v2/checkout/orders` and captures it on return with `POST /v2/checkout/orders/{id}/capture` (`server/paypal.js`). Amount, currency and quantity come from the server, never from the browser or a model.
- **Payments v2.** The Confirm-gated refund calls the Captures Refund API, `POST /v2/payments/captures/{id}/refund`, always for the recorded capture amount, with a fixed `PayPal-Request-Id` so a repeated click cannot refund twice.
- **Verified webhooks.** `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` are verified with PayPal's postback check (`/v1/notifications/verify-webhook-signature`) on the raw request body before anything is written (`server/webhook.js`). Every verified event is recorded and shown in the PayPal events drawer.

Sandbox only: the server refuses any PayPal host other than `https://api-m.sandbox.paypal.com`.

## Run locally

Requires Node 22.12 or later.

```sh
npm install
cp .env.example .env    # fill in PayPal Sandbox and Supabase values
npm run dev
```

Open `http://localhost:3000`. Without PayPal credentials the dashboard loads but checkout is disabled. Without `NVIDIA_API_KEY` the seat assistant is disabled; without `ANTHROPIC_API_KEY` Ask AI is disabled. The API refuses non-sandbox PayPal hosts. Local webhooks need a public HTTPS tunnel to `/api/paypal/webhook`.

Production build: `npm run build` then `npm start`. On Vercel the API runs as one Function (`api/index.js`, `vercel.json`); set `NODEJS_HELPERS=0` so the webhook sees the raw body.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no | Local server port (default 3000). |
| `APP_BASE_URL` | yes | Public base URL; PayPal returns the buyer here. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` | yes | PayPal Sandbox REST app credentials. |
| `PAYPAL_BASE_URL` | no | Must be `https://api-m.sandbox.paypal.com`; anything else is refused. |
| `PAYPAL_WEBHOOK_ID` | yes for webhooks | Sandbox webhook subscription ID used for signature verification. |
| `SUPABASE_URL` | yes | Hackathon Supabase project URL. |
| `SUPABASE_ANON_KEY` | yes | Publishable key, served to the browser for sign-in. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Secret key, server only, for ledger reads and writes. |
| `NVIDIA_API_KEY` | for the seat assistant | NVIDIA hosted API key (build.nvidia.com). |
| `ANTHROPIC_API_KEY` | for Ask AI | Anthropic API key for the analytics assistant. |
| `STUDIO_AI_MODEL` | no | Overrides the Ask AI model (default in `server/config.js`). |
| `STUDIO_AI_TIMING` | no | `1` logs one timing row per Ask AI model turn. |
| `NODEJS_HELPERS` | Vercel only | `0` keeps the request body unparsed for webhook verification. |

`TRIALS` and `TIMEOUT_MIN` are read only by the probe and timing scripts.

## Database migrations

Apply the files in `supabase/migrations` in order, in the Supabase SQL editor or with the Supabase CLI. Each is one transaction and safe to re-run.

1. `20261027054700_paypal_orders_and_entitlements.sql`: PayPal orders, payments, and seat entitlements.
2. `20261028150000_agent_actions_and_seat_quantity.sql`: multi-seat quantity, the seat assistant's `agent_actions` log, and the idempotent seat grant function.
3. `20261028200000_rename_seat_grant.sql`: renames the grant function to `grant_seat_access` and the entitlement product code to `instructor_seat`, converting existing rows. If you re-run file 2 later, run file 3 again after it.
4. `20261031180000_seat_proposals.sql`: the `seat_proposals` table, where a proposal waits up to 10 minutes for Confirm. Server-only (RLS on, no policies).
5. `20261101200000_paypal_webhook_events.sql`: the `paypal_webhook_events` table behind the PayPal events drawer. One row per verified event, keyed by PayPal's event ID; no payer details. Server-only.
6. `20261102000000_refunds_and_seat_revoke.sql`: the `REFUNDED` status on `paypal_orders` and `paypal_payments`, `refund_id` and `refunded_at` on payments, and `revoke_seat_access`, which locks the order, checks the refund equals the captured amount, marks both rows `REFUNDED`, and deactivates the seat entitlement only when the instructor has no other completed order. Until it is applied, a refund webhook answers 5xx (PayPal retries) and nothing changes. The PayPal webhook subscription must also include `PAYMENT.CAPTURE.REFUNDED`.

## Tests

```sh
npm test                 # server, analytics and component tests; no network calls
npm run test:browser     # headless Chromium: Ask AI lead → Seat agent → Confirm → PayPal, against the real API routes
npm run check:strict-tools   # offline check of AG Studio's tool schemas against Anthropic's strict-mode rules
```

`npm test` uses scripted model clients and fakes for Supabase and PayPal. `npm run test:browser` needs Playwright's Chromium once (`npx playwright install chromium`); it fakes only outside services (Supabase, NVIDIA, PayPal, the Ask AI lead's model turns).

## Project structure

- `server/app.js`: the Express API (every `/api` route). `server/index.js` adds the client and listens locally; `api/index.js` is the Vercel Function entry.
- `server/paypal.js`: OAuth, Orders v2 create and capture, webhook signature verification. `server/webhook.js`: verified webhook handling and event recording.
- `server/supabase.js`: token validation, orders, grants, proposals, webhook events. `server/seatUnlock.js`: the ledger. `server/analytics.js`: orders shaped for AG Studio.
- `server/agent.js`: the seat assistant (tool loop, guardrails, proposals). `server/studioAi.js`: the sign-in-only Ask AI proxy to the Anthropic Messages API.
- `src/App.jsx`, `src/components/`: Overview, seat assistant panel, ledger grids, PayPal events drawer, Instructor analytics.
- `src/analytics/`: AG Studio data source, default report, brand theme, custom widgets (Revenue Tile, Seat Progress, Class Fill), agent tuning, the Seat agent.
- `supabase/migrations/`: schema and the seat grant function. `scripts/`: model probe and timing tools.

## How AI is used

**Seat assistant.** The server calls NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`, `server/config.js`) on NVIDIA's hosted OpenAI-compatible endpoint with standard function calling. Three tools, all in `server/agent.js` on top of the checkout code: `get_seat_pricing`, `get_current_seats` (the caller's own orders only), and `create_seat_order(quantity, class_name)`, which validates and returns a proposal without calling PayPal. The PayPal Agent Toolkit was not used: its `create_order` takes order details from the model, and here price and order creation are fixed on the server.

**Guardrails.** Quantity is a whole number from 1 to 200, checked on the server. Off-topic requests are declined by the prompt and, in code, by discarding any tool-free reply that is not about seats (`off_topic_blocked`). Every request is tied to the verified Supabase user; a proposal can be confirmed only by its creator, once, within 10 minutes. The browser can send only plain-text turns. Each action is logged to `agent_actions`.

**Ask AI (AG Studio Agent Framework).** On Instructor analytics, Ask AI opens Studio's assistant beside the report. It runs on Claude Sonnet 5.5 (`claude-sonnet-5-5`, effort `low`, `server/config.js`), chosen after a live comparison with Claude Haiku 5.5 on tool-call validity (Sonnet 0 failed tool calls, Haiku 2; details in HANDOFF.md). Turns go through `POST /api/studio-ai/chat` (`server/studioAi.js`), which requires the signed-in token, translates Chat Completions-shaped turns to the Anthropic Messages API and back, streams with a first-content retry, drops thinking, and accepts only Studio's own tools (read schema and data, edit widgets, filters, pages, plans). It cannot create orders. `src/analytics/studioAgents.js` preloads the report, schema and page into each built-in agent and keeps replies to one sentence. Tools are sent without `strict: true` (see `npm run check:strict-tools`).

**Seat agent (custom Studio agent).** `src/analytics/seatAgent.js` registers a `seat` agent beside Studio's lead, data, widget, page and planning agents. The lead delegates seat requests to it; it runs code, not a model loop: it posts the instruction to `POST /api/agent/chat`, shows the reply, hands any proposal to the Confirm bar above the report, and reports back with `complete_task`. Confirm uses the same endpoint as the Overview assistant.

**Refunds.** The seat assistant can also prepare a refund of the instructor's most recent paid order (`propose_refund`); a Confirm bar shows the capture ID and amount, and only that click calls the Captures Refund API (`POST /api/paypal/captures/:captureId/refund`). A refund from any source, that Confirm or the PayPal Sandbox Dashboard, arrives as `PAYMENT.CAPTURE.REFUNDED`. The handler verifies it, finds the seat order through the refund's capture, and revokes the seats only for a completed refund of the full captured amount in the captured currency. The ledger shows the order as `REFUNDED` with the student marked "Seat revoked", the class seats grid counts it under Refunded, and analytics shows it as Refunded with no revenue. Partial refunds, refunds of captures this app never recorded, and refunds still pending are recorded in the events drawer and change nothing.

**Instructor analytics (AG Grid, AG Charts, AG Studio).** The ledger grids on Overview are AG Grid; the analytics page is an AG Studio report, whose charts are AG Charts and whose grids are AG Grid. `GET /api/analytics/orders` returns the signed-in instructor's orders with seats and money split by status. The report (`src/analytics/initialReport.js`) shows Revenue, Seats unlocked vs pending, Awaiting payment, Orders, seats and order value by day, Class fill (unlocked seats against the planned class size per class) and Orders by class. The theme (`src/analytics/theme.js`) uses the Sentinel Learning brand tokens from `src/styles.css`. AG Studio 3.0.0 pins AG Grid 36.2; no licence key is configured, so Studio shows a watermark.

## License

[MIT](LICENSE). Copyright (c) 2026 Eddie Bax88.
