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
- `server/supabase.js` validates checkout access tokens and persists PayPal orders and Sentinel Volt grants.
- `server/seatUnlock.js` validates completed captures, enforces the fixed seat quota, and records transactions.
- `src/components/SeatTable.jsx` shows transactions, quota, and student readiness.
- `src/components/NecDemo.jsx` provides a deterministic sample five-step lookup.

## Sandbox checkout

The server uses the PayPal Checkout Orders v2 API through the APIMatic-documented operations:

- `POST /v2/checkout/orders`
- `POST /v2/checkout/orders/{id}/capture`

Set `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` to sandbox app credentials in the ignored `.env` file. Set `PAYPAL_WEBHOOK_ID` to the sandbox webhook subscription ID to enable webhook verification. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; the service-role key must remain server-side. Apply the migration in `supabase/migrations` before enabling checkout. Order-creation and capture requests must send the signed-in Supabase access token as `Authorization: Bearer <access-token>`. The server validates the token with Supabase Auth and stores the resulting user ID in the PayPal order; it never accepts a caller-supplied user ID. The server uses only `https://api-m.sandbox.paypal.com`; seat price (`USD 49.00`) and cohort capacity are fixed server-side. Sentinel Volt access is granted only for a completed capture with the expected amount and currency, either from the Orders API response or a cryptographically verified `PAYMENT.CAPTURE.COMPLETED` webhook.

The durable PayPal-order association and Sentinel Volt entitlement are stored in Supabase. The demo dashboard's seat reservations and transaction display remain in memory; restarting the server clears those dashboard records. PayPal webhook delivery requires a publicly reachable HTTPS URL, so local webhooks need a secure forwarding/tunnel setup.

The NEC lookup contains fictional sample labels and paraphrased navigation only; it does not reproduce code-book text or connect to a live platform.

## Production build

```sh
npm run build
npm start
```

Run deterministic seat-unlock tests with `npm test`.
