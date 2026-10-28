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
- `server/agent.js` runs the seat assistant: the Claude tool loop, guardrails, and confirm-before-order proposals.
- `server/supabase.js` validates checkout access tokens and persists PayPal orders and Sentinel Volt grants.
- `server/seatUnlock.js` validates completed captures, enforces the fixed seat quota, and records transactions.
- `src/components/AgentPanel.jsx` is the seat assistant panel with the Confirm step.
- `src/components/SeatTable.jsx` shows transactions, quota, and student readiness.
- `src/components/NecDemo.jsx` provides a deterministic sample five-step lookup.

## Sandbox checkout

The server uses the PayPal Checkout Orders v2 API through the APIMatic-documented operations:

- `POST /v2/checkout/orders`
- `POST /v2/checkout/orders/{id}/capture`

Set `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` to sandbox app credentials in the ignored `.env` file. Set `PAYPAL_WEBHOOK_ID` to the sandbox webhook subscription ID to enable webhook verification. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; the service-role key must remain server-side. Apply the migration in `supabase/migrations` before enabling checkout. Order-creation and capture requests must send the signed-in Supabase access token as `Authorization: Bearer <access-token>`. The server validates the token with Supabase Auth and stores the resulting user ID in the PayPal order; it never accepts a caller-supplied user ID. The server uses only `https://api-m.sandbox.paypal.com`; seat price (`USD 49.00`) and cohort capacity are fixed server-side. Sentinel Volt access is granted only for a completed capture with the expected amount and currency, either from the Orders API response or a cryptographically verified `PAYMENT.CAPTURE.COMPLETED` webhook.

The durable PayPal-order association and Sentinel Volt entitlement are stored in Supabase. The demo dashboard's seat reservations and transaction display remain in memory; restarting the server clears those dashboard records. PayPal webhook delivery requires a publicly reachable HTTPS URL, so local webhooks need a secure forwarding/tunnel setup.

The NEC lookup contains fictional sample labels and paraphrased navigation only; it does not reproduce code-book text or connect to a live platform.

## How AI is used

The dashboard has a seat assistant. A signed-in instructor types a request in plain English, such as "Buy 12 seats for my fall class."

**Model and SDK.** The server calls Claude Opus 5.5 (`claude-opus-5-5`) through the official Anthropic TypeScript SDK (`@anthropic-ai/sdk`), with server-side refusal fallback enabled. Set `ANTHROPIC_API_KEY` in `.env`; the key never reaches the browser.

**Tools.** The model can call three tools, all implemented in `server/agent.js` on top of the existing checkout code:

- `get_seat_pricing`: the fixed seat price (`USD 49.00`), currency, and per-order limit.
- `get_current_seats`: cohort capacity, seats available, and the signed-in instructor's own orders.
- `create_seat_order(quantity, class_name)`: validates the request and prepares a proposal. It does not call PayPal.

The PayPal Agent Toolkit (`@paypal/agent-toolkit`) was not used. It ships adapters for the OpenAI Agents SDK, LangChain, Vercel AI SDK, MCP, and Bedrock, not the Anthropic SDK, and its `create_order` tool takes order details from the model. Here the price is fixed on the server and every order goes through the existing `createSandboxOrder` path and `paypal_orders` insert.

**Why approval is required.** The model never creates an order or moves money. `create_seat_order` only returns a proposal showing quantity, unit price, and total. The order is created only when the instructor clicks **Confirm**, which calls `POST /api/agent/proposals/:id/confirm`. That creates the PayPal Sandbox order and returns the approval link. Payment is captured only after the instructor approves it on PayPal, and seats are granted only by the existing verified-capture path and `grant_sentinel_volt_access` function. A language model can misread a request, so a person checks the amount before anything is charged.

**Guardrails.**

- Quantity must be a whole number from 1 to 200 and cannot exceed the seats left in the cohort. The server checks this; the model's input is never trusted.
- The system prompt limits the assistant to seat pricing, availability, and purchases, and tells it to decline anything else. This is enforced by the model's instructions, not by code.
- Every request is tied to the Supabase user from the verified access token. Tools never accept a user ID, `get_current_seats` returns only the caller's orders, and a proposal can be confirmed only by the instructor who created it, once, within 10 minutes.
- The browser can send only plain-text turns; tool results and system messages from the client are rejected.
- Each agent action (request, tool call, rejected tool call, proposal, reply, confirmation, order result) is logged to the `agent_actions` table. Apply `supabase/migrations/20261028150000_agent_actions_and_seat_quantity.sql` to create it and to allow multi-seat orders.

Proposals are held in server memory, like the demo's seat ledger, so restarting the server clears them.

## Production build

```sh
npm run build
npm start
```

Run the deterministic tests (seat unlock, PayPal, Supabase, and seat assistant tools and guardrails) with `npm test`. The assistant tests use a scripted model client and make no network calls.
