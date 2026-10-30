# Sentinel Instructor Dashboard

A compact instructor dashboard demo for one PayPal Sandbox seat checkout, server-side capture, and verified cohort seat unlock.

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. Add sandbox credentials to `.env` to enable the purchase flow. Never use live credentials. The API refuses non-sandbox PayPal hosts.

## Project structure

- `server/index.js` serves the dashboard and exposes checkout and dashboard endpoints.
- `server/paypal.js` handles OAuth, Orders v2 create/capture, and sandbox webhook verification.
- `server/webhook.js` verifies capture event signatures before processing them.
- `server/config.js` holds the default class size (`DEFAULT_CLASS_SIZE`, 30), the per-order seat limit (`MAX_SEATS_PER_ORDER`, 200), and the seat assistant's model and endpoint.
- `server/agent.js` runs the seat assistant: the tool-calling loop, guardrails, and confirm-before-order proposals.
- `server/supabase.js` validates checkout access tokens and persists PayPal orders and seat grants.
- `server/seatUnlock.js` validates completed captures, counts seats sold and pending against the default class size, and records transactions.
- `src/components/AgentPanel.jsx` is the seat assistant panel with the Confirm step.
- `server/analytics.js` serves `GET /api/analytics/orders`, the signed-in instructor's orders shaped for AG Studio.
- `src/components/InstructorAnalytics.jsx` renders the Instructor analytics view with AG Studio; its data source, default report, theme, and custom widgets are in `src/analytics/`.
- `src/components/SeatTable.jsx` shows transactions, class seats, and student readiness.

## Sandbox checkout

The server uses the PayPal Checkout Orders v2 API through the APIMatic-documented operations:

- `POST /v2/checkout/orders`
- `POST /v2/checkout/orders/{id}/capture`

Set `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` to sandbox app credentials in the ignored `.env` file. Set `PAYPAL_WEBHOOK_ID` to the sandbox webhook subscription ID to enable webhook verification. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; the service-role key must remain server-side. Apply the migration in `supabase/migrations` before enabling checkout. Order-creation and capture requests must send the signed-in Supabase access token as `Authorization: Bearer <access-token>`. The server validates the token with Supabase Auth and stores the resulting user ID in the PayPal order; it never accepts a caller-supplied user ID. The server uses only `https://api-m.sandbox.paypal.com`; seat price (`USD 49.00`) and the per-order limit (1 to 200 seats) are fixed server-side. There is no cohort-wide seat cap. Seats are granted only for a completed capture with the expected amount and currency, either from the Orders API response or a cryptographically verified `PAYMENT.CAPTURE.COMPLETED` webhook.

The durable PayPal-order association and seat grants are stored in Supabase. The dashboard ledger (transactions, class seats, student readiness) is read from Supabase `paypal_orders` through `GET /api/ledger`, which requires the signed-in access token and returns only that instructor's orders; the server applies the user filter with the secret key, so the browser never chooses whose orders it sees. Pending seats count by order quantity. Capture and the PayPal webhook also read the order from Supabase, so both work after a server restart. A capture is accepted only for the signed-in owner of the order and only if the amount equals USD 49.00 × quantity. The seat grant function marks the order completed and writes `paypal_payments` in one transaction, and returns without granting again for a capture it has already recorded, so duplicate captures and webhooks are no-ops. The server keeps no order state in memory. PayPal webhook delivery requires a publicly reachable HTTPS URL, so local webhooks need a secure forwarding/tunnel setup.

## Instructor analytics (AG Studio)

The **Instructor analytics** link in the sidebar opens an [AG Studio](https://www.ag-grid.com/studio/) report over the signed-in instructor's own seat orders: revenue, seats unlocked vs pending, seats and order value by day, and orders by class. **Edit layout** switches Studio to edit mode to add or change widgets; changes last until the page reloads.

- **Data.** `GET /api/analytics/orders` requires the signed-in Supabase access token. The server reads `paypal_orders` filtered to the user ID from the verified token, never from the request, and returns plain numbers and ISO dates with seats and money already split by status.
- **Custom widgets** (`src/analytics/widgets.jsx`): **Revenue Tile**, a large money value with a supporting number, and **Seat Progress**, unlocked and pending seats as a bar against the default class size (`DEFAULT_CLASS_SIZE` in `server/config.js`, passed to Studio as context). Both appear under **Instructor** in the widget menu.
- **Theme** (`src/analytics/theme.js`): Studio's theme points at the dashboard's CSS tokens in `src/styles.css`, so widgets, grids, and charts match the rest of the page.
- **Versions.** AG Studio 3.0.0 requires AG Grid 36.2 and AG Charts 14.2, so `ag-studio`, `ag-studio-react`, `ag-grid-community`, and `ag-grid-react` are pinned to exact versions.
- **Licence.** No key is configured. AG Studio runs locally without one and shows a watermark and console warnings.

## How AI is used

The dashboard has a seat assistant. A signed-in instructor types a request in plain English, such as "Buy 12 seats for my fall class."

**Model and SDK.** The server calls NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`) on NVIDIA's hosted API (build.nvidia.com). It uses the `openai` npm client pointed at NVIDIA's OpenAI-compatible endpoint, `https://integrate.api.nvidia.com/v1`, with standard function calling. NVIDIA's model card documents tool calling for this model, and the requests send the `chat_template_kwargs` it requires for tool calls. Set `NVIDIA_API_KEY` in `.env`; the key never reaches the browser. The model name and endpoint live in `server/config.js`.

**Tools.** The model can call three tools, all implemented in `server/agent.js` on top of the existing checkout code:

- `get_seat_pricing`: the fixed seat price (`USD 49.00`), currency, and per-order limit.
- `get_current_seats`: the default class size, seats sold and pending, seats remaining to reach that size, and the signed-in instructor's own orders.
- `create_seat_order(quantity, class_name)`: validates the request and prepares a proposal. It does not call PayPal.

The PayPal Agent Toolkit (`@paypal/agent-toolkit`) was not used. Its `create_order` tool takes order details from the model, and its adapters target agent frameworks this server doesn't use. Here the price is fixed on the server and every order goes through the existing `createSandboxOrder` path and `paypal_orders` insert.

**Why approval is required.** The model never creates an order or moves money. `create_seat_order` only returns a proposal showing quantity, unit price, and total. The order is created only when the instructor clicks **Confirm**, which calls `POST /api/agent/proposals/:id/confirm`. That creates the PayPal Sandbox order and returns the approval link. Payment is captured only after the instructor approves it on PayPal, and seats are granted only by the existing verified-capture path and seat grant function. A language model can misread a request, so a person checks the amount before anything is charged.

**Guardrails.**

- Quantity must be a whole number from 1 to 200 per order. The server checks this; the model's input is never trusted. That is the only seat cap: the default class size of 30 is a planning number shown on the dashboard and suggested by the assistant, not a limit.
- Off-topic requests are blocked in two layers. The system prompt tells the model to decline anything that isn't seat pricing, availability, or purchases. Then, in code, if the model's turn used no tools and the latest message isn't about seats or orders (and isn't a short reply to a seat question), the server discards the model's reply and returns a fixed decline. That event is logged as `off_topic_blocked`.
- Every request is tied to the Supabase user from the verified access token. Tools never accept a user ID, `get_current_seats` returns only the caller's orders, and a proposal can be confirmed only by the instructor who created it, once, within 10 minutes.
- The browser can send only plain-text turns; tool results and system messages from the client are rejected.
- Each agent action (request, tool call, rejected tool call, proposal, reply, confirmation, order result) is logged to the `agent_actions` table. Apply `supabase/migrations/20261028150000_agent_actions_and_seat_quantity.sql` to create it and to allow multi-seat orders.

Proposals are held in server memory, like the demo's seat ledger, so restarting the server clears them.

## Database migrations

Apply the files in `supabase/migrations` in order, in the Supabase SQL editor or with the Supabase CLI:

1. `20261027054700_paypal_orders_and_entitlements.sql`: PayPal orders, payments, and seat entitlements.
2. `20261028150000_agent_actions_and_seat_quantity.sql`: multi-seat quantity, the seat assistant's `agent_actions` log, and the idempotent seat grant function. Safe to re-run.
3. `20261028200000_rename_seat_grant.sql`: renames the seat grant function to `grant_seat_access` and the entitlement product code to `instructor_seat`, converting existing rows, then drops the old function. Safe to re-run.

Run them in this order. If you re-run file 2 later, run file 3 again after it, since file 2 recreates the function under its original name. The server calls the function named by `SEAT_GRANT_FUNCTION` in `server/supabase.js`, which is `grant_seat_access`, so apply file 3 before running this version of the server.

The first file was renamed from its original name; its SQL is unchanged. The Supabase CLI tracks migrations by the numeric version prefix, which did not change, so an already-applied database needs no action.

### Analytics assistant (AG Studio Agent Framework)

On **Instructor analytics**, **Ask AI** opens AG Studio's AI Assistant beside the report, with suggestions such as "Show revenue by class" and "Seats pending by day". It answers questions about the instructor's own orders and adds or changes widgets.

- **Model.** NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`) with thinking on, the same model and settings as the seat assistant (`AGENT_MODEL` and `AGENT_TEMPLATE_KWARGS` in `server/config.js`). Studio's built-in agents (lead, data, widget, page, planning) take several tool-calling rounds per question, so a question can take 10 to 25 seconds; a status bar above the report shows the assistant is working and for how long.
- **Adapter and proxy.** `src/analytics/nvidiaAdapter.js` is a Chat Completions adapter for Studio. It posts each turn to `POST /api/studio-ai/chat` (`server/studioAi.js`), which requires the signed-in Supabase token, adds the NVIDIA key, chooses the model and settings, strips reasoning text (`</think>` and reasoning fields), and returns only the cleaned message and tool calls. The key never reaches the browser.
- **Read and build only.** The proxy accepts only AG Studio's own tools (reading the schema and data, and editing widgets, filters, pages, and plans in the browser) and refuses any request that offers or replays another tool. The assistant cannot create orders or take payments; purchases stay in the seat assistant with its Confirm step.
- **Checking a model.** `npm run probe:studio-agent` replays Studio's real first-turn requests for each agent (`scripts/fixtures/studio-agent-requests.json`) against NVIDIA with your `NVIDIA_API_KEY`, and reports, per model and setting, how many turns returned valid tool calls and how long they took.
- **Timing a question.** `npm run time:ask-ai` runs one Ask AI question (default: "Add a pie chart of seats unlocked vs pending.") through the real analytics view in headless Chromium, with sample orders and no sign-in, and prints one row per model turn: agent, latency, thinking, output and input tokens, and the tool called, plus the total. Pass another question as an argument. Needs `NVIDIA_API_KEY` and, once, `npx playwright install chromium`. Set `STUDIO_AI_TIMING=1` to log the same per-turn row from the running app's proxy.

## Production build

```sh
npm run build
npm start
```

Run the deterministic tests (seat unlock, PayPal, Supabase, and seat assistant tools and guardrails) with `npm test`. The assistant tests use a scripted model client and make no network calls.
