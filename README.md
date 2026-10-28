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
- `server/supabase.js` validates checkout access tokens and persists PayPal orders and Sentinel Volt grants.
- `server/seatUnlock.js` validates completed captures, counts seats sold and pending against the default class size, and records transactions.
- `src/components/AgentPanel.jsx` is the seat assistant panel with the Confirm step.
- `src/components/SeatTable.jsx` shows transactions, class seats, and student readiness.
- `src/components/NecDemo.jsx` provides a deterministic sample five-step lookup.

## Sandbox checkout

The server uses the PayPal Checkout Orders v2 API through the APIMatic-documented operations:

- `POST /v2/checkout/orders`
- `POST /v2/checkout/orders/{id}/capture`

Set `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` to sandbox app credentials in the ignored `.env` file. Set `PAYPAL_WEBHOOK_ID` to the sandbox webhook subscription ID to enable webhook verification. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; the service-role key must remain server-side. Apply the migration in `supabase/migrations` before enabling checkout. Order-creation and capture requests must send the signed-in Supabase access token as `Authorization: Bearer <access-token>`. The server validates the token with Supabase Auth and stores the resulting user ID in the PayPal order; it never accepts a caller-supplied user ID. The server uses only `https://api-m.sandbox.paypal.com`; seat price (`USD 49.00`) and the per-order limit (1 to 200 seats) are fixed server-side. There is no cohort-wide seat cap. Sentinel Volt access is granted only for a completed capture with the expected amount and currency, either from the Orders API response or a cryptographically verified `PAYMENT.CAPTURE.COMPLETED` webhook.

The durable PayPal-order association and Sentinel Volt entitlement are stored in Supabase. The dashboard ledger (transactions, class seats, student readiness) is read from Supabase `paypal_orders` through `GET /api/ledger`, which requires the signed-in access token and returns only that instructor's orders; the server applies the user filter with the secret key, so the browser never chooses whose orders it sees. Pending seats count by order quantity. Capture and the PayPal webhook also read the order from Supabase, so both work after a server restart. A capture is accepted only for the signed-in owner of the order and only if the amount equals USD 49.00 × quantity. The `grant_sentinel_volt_access` function marks the order completed and writes `paypal_payments` in one transaction, and returns without granting again for a capture it has already recorded, so duplicate captures and webhooks are no-ops. The server keeps no order state in memory. PayPal webhook delivery requires a publicly reachable HTTPS URL, so local webhooks need a secure forwarding/tunnel setup.

The NEC lookup contains fictional sample labels and paraphrased navigation only; it does not reproduce code-book text or connect to a live platform.

## How AI is used

The dashboard has a seat assistant. A signed-in instructor types a request in plain English, such as "Buy 12 seats for my fall class."

**Model and SDK.** The server calls NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`) on NVIDIA's hosted API (build.nvidia.com). It uses the `openai` npm client pointed at NVIDIA's OpenAI-compatible endpoint, `https://integrate.api.nvidia.com/v1`, with standard function calling. NVIDIA's model card documents tool calling for this model, and the requests send the `chat_template_kwargs` it requires for tool calls. Set `NVIDIA_API_KEY` in `.env`; the key never reaches the browser. The model name and endpoint live in `server/config.js`.

**Tools.** The model can call three tools, all implemented in `server/agent.js` on top of the existing checkout code:

- `get_seat_pricing`: the fixed seat price (`USD 49.00`), currency, and per-order limit.
- `get_current_seats`: the default class size, seats sold and pending, seats remaining to reach that size, and the signed-in instructor's own orders.
- `create_seat_order(quantity, class_name)`: validates the request and prepares a proposal. It does not call PayPal.

The PayPal Agent Toolkit (`@paypal/agent-toolkit`) was not used. Its `create_order` tool takes order details from the model, and its adapters target agent frameworks this server doesn't use. Here the price is fixed on the server and every order goes through the existing `createSandboxOrder` path and `paypal_orders` insert.

**Why approval is required.** The model never creates an order or moves money. `create_seat_order` only returns a proposal showing quantity, unit price, and total. The order is created only when the instructor clicks **Confirm**, which calls `POST /api/agent/proposals/:id/confirm`. That creates the PayPal Sandbox order and returns the approval link. Payment is captured only after the instructor approves it on PayPal, and seats are granted only by the existing verified-capture path and `grant_sentinel_volt_access` function. A language model can misread a request, so a person checks the amount before anything is charged.

**Guardrails.**

- Quantity must be a whole number from 1 to 200 per order. The server checks this; the model's input is never trusted. That is the only seat cap: the default class size of 30 is a planning number shown on the dashboard and suggested by the assistant, not a limit.
- Off-topic requests are blocked in two layers. The system prompt tells the model to decline anything that isn't seat pricing, availability, or purchases. Then, in code, if the model's turn used no tools and the latest message isn't about seats or orders (and isn't a short reply to a seat question), the server discards the model's reply and returns a fixed decline. That event is logged as `off_topic_blocked`.
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
