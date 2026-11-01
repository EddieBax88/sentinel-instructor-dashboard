# Handoff: Sentinel Instructor Dashboard (PayPal AI Hackathon)

Due Nov 12, 2026, 12:00pm PT. Judging Dec 1–15.

## Repo state (Nov 1, 2026, end of the unattended session)

- Repo: `EddieBax88/sentinel-instructor-dashboard` (public). Branch: `ccr-1d301b90-3tuzmz`. Vercel Production tracks this branch and auto-deploys every push.
- PR #1 (draft) is open against `main`. Never merge to `main` without Eddie. PR #2 (`ccr-90064225-vddchi` into this branch) shows as merged: its one commit (31d7e60) was fast-forwarded onto this branch, and GitHub marked the PR merged when it landed (Nov 1, 20:39 UTC). Nothing to do; the `ccr-90064225-vddchi` branch can be deleted.
- Commits this session, oldest first (each pushed, deployed READY on Vercel, and `GET /api/health` answered `{"status":"ok"}` after the deploy):
  - `31d7e60` HANDOFF: hosted demo, live webhook, applied migrations, Seat agent recorded.
  - `f4d2ae6` Brand theme (Inter + Fraunces, oklch tokens), Class fill widget, sidebar link to www.sentinellearning.com.
  - `f6b5a8b` Repo hygiene for judges: README rewritten, .env.example complete, cloudflared.deb removed from the tree.
  - `08e06b2` Refund to seat revoke: PAYMENT.CAPTURE.REFUNDED handling, migration written (not applied), Refunded state in ledger, analytics and grid.
  - `66f9956` DEMO-SCRIPT.md: sub-3-minute click path.
  - This file's commit (final HANDOFF).
- Tests: `npm test` 126/126 pass (no network calls); `npm run test:browser` 1/1 pass (headless Chromium, Ask AI lead to Seat agent to Confirm to PayPal, against the real API routes).
- Node: `engines.node` is `22.x` (Vercel deploys Node 26 for `>=22`; Supabase and openai need 22, Vite needs 22.12).
- Hosted demo: https://sentinel-hackathon-demo-mu.vercel.app (Vercel Hobby, project `sentinel-hackathon-demo`).
- Migrations applied to the hackathon Supabase project: the first five in `supabase/migrations` (through `20261101200000_paypal_webhook_events.sql`).
- Migration written, NOT applied: `20261102000000_refunds_and_seat_revoke.sql`. See "Owner decisions needed".
- PayPal sandbox webhook: verified live for `PAYMENT.CAPTURE.COMPLETED`. `PAYMENT.CAPTURE.REFUNDED` is not yet on the subscription.

## Owner decisions needed

1. **Apply the refund migration.** Run `supabase/migrations/20261102000000_refunds_and_seat_revoke.sql` in the hackathon project's SQL editor (one transaction, safe to re-run). Until then a refund webhook answers 5xx (PayPal retries for 3 days) and nothing changes.
2. **Add `PAYMENT.CAPTURE.REFUNDED` to the PayPal sandbox webhook subscription** (developer.paypal.com > Apps & Credentials > the sandbox app > Webhooks > edit the `<demo URL>/api/paypal/webhook` subscription > add the event). Then test live: refund the sandbox capture in full from the business account's Activity page and check the drawer, ledger and analytics. Do this before recording the refund part of the video.
3. **Judge test account.** README has the demo URL and says to create an account. No shared judge credentials were created or written anywhere (a public repo is the wrong place). Decide whether to create one and where to give it to judges (the submission form, not the repo).
4. **cloudflared.deb in history.** It is out of the tree but still in git history: the commit that added it (`4a52b8a`) is on `main`, which PR #1 targets, so rewriting it means rewriting `main`. The earlier plan item "scrub git history right before submission, keeping commit dates" would cover it; that rewrite needs you.
5. **Logo.** No logo asset exists in the repo, so the sidebar keeps the GraduationCap mark with "sentinel." in Fraunces. Supply a logo file if you want the real mark.
6. **AA contrast choice.** White text on the raw brand primary `oklch(58% .19 50)` is 4.45:1, just under WCAG AA for normal text, so buttons and small primary text use a darker step `--primary-strong oklch(50% .17 50)` (6.2:1). The raw primary is used for large text, bars, icons and chart 1. Override in `src/styles.css` if you want the raw primary on buttons regardless.
7. **Delete the leftover branch `ccr-90064225-vddchi`** (PR #2 is already merged, see above).
8. **Anthropic key (~Nov 2):** live probe and Ask AI timing on Claude (`npm run probe:studio-agent`, then pick model and effort in `server/config.js`); check the live lead-to-Seat-agent handoff; revisit strict tools if the probe shows malformed calls.
9. **AG Studio trial license (~Nov 5):** key via env, served to the browser like the Supabase publishable key, to remove the watermark.

## Hard rules

- No code or content from Sentinel's other products in this repo.
- Supabase: the hackathon project only (its URL is in local `.env`). Never touch the production project.
- Keys only in local `.env` (gitignored). Never print or commit keys. Secret scan before every push. (`server/studioAi.test.js` contains the obviously fake string `sk-ant-test-key-that-must-never-reach-the-browser`; naive scanners flag it.)
- Eddie runs SQL migrations himself in the Supabase SQL editor. Every migration must be safe to re-run and wrapped in one transaction.
- One task at a time. After each task: report commit hash, test count and exact steps for Eddie, then stop.

## Stack

Node/Express server + React/Vite client, Supabase (auth + Postgres), PayPal Sandbox, NVIDIA hosted API (OpenAI-compatible, `openai` SDK) for the seat agent, Anthropic Messages API (`@anthropic-ai/sdk` 1.3.0) for Ask AI, AG Studio 3.0.0 with AG Grid pinned to 36.2.0. No AG Studio license yet (watermark is fine).

## Verified working

- Seat agent (NVIDIA Nemotron 3 Ultra): plain English to server-priced proposal to Confirm to PayPal Sandbox to capture to seats granted. Off-topic blocked server-side. (Eddie's machine and the hosted demo.)
- Ledger and capture read from Supabase, scoped to the signed-in instructor. Idempotent.
- Hosted demo: API as one Vercel Function, seat proposals in Supabase. Webhook verified live; verified events recorded in `paypal_webhook_events`; event drawer verified with real events (Nov 1).
- Brand theme (`f4d2ae6`), checked in headless Chromium against stubbed data: Inter and Fraunces load, the Class fill widget renders grouped rows from Studio (`Spring class 30 / 30`, `Fall class 12 / 30`), the Revenue and Seat progress tiles render, charts use the brand palette, the footer link opens www.sentinellearning.com in a new tab, no page errors. The live site serves the new theme (checked after deploy).
- Refund handling (`08e06b2`): 10 webhook tests against fakes (full refund revokes once; retry answers already revoked; refunding the last completed order deactivates access; partial, other-currency, missing-amount, pending, unknown-capture and no-link refunds change nothing; bad signature records nothing; Supabase failure answers 502). NOT yet verified live (migration and webhook event pending).
- Instructor analytics (AG Studio): KPIs, charts, Class fill, by-class grid, custom widgets, theme.
- Earlier probe results and Ask AI timings on NVIDIA are unchanged from the previous handoff (Ultra 10/10 valid tool calls, median 4.9 s; Nemotron 3.5 Super VL 10/10, 11.0 s; Nemotron 3 Super 404 on the free endpoint).

## Not yet verified live

- Refund to seat revoke (see Owner decisions 1 and 2).
- Seat agent in Ask AI through a live Claude lead (needs the Anthropic key). The headless test uses a scripted lead.
- Ask AI on Claude (built against fakes, no live key yet): proxy translation, streaming with 10 s first-content retry, refusal as a clean 422, timing rows, probe settings. Default model `claude-sonnet-5-5`, effort `low` (`server/config.js`) is a placeholder until the live probe.
- `npm run time:ask-ai` (headless harness) hung on Eddie's machine before the 5-minute timeout was added; not debugged. Still times the NVIDIA path.

## Things that looked worse or need a second look

- AG Studio converts computed colors for AG Charts' canvas only from `rgb()` or `color(srgb)`. With oklch tokens the charts silently fell back to Studio's default blue/green palette; fixed by giving chart tokens sRGB hex values (`--chart-*`, `--chart-text`, `--chart-line` in `src/styles.css`). Any new Studio color param that reaches a chart must use those hex tokens, not the oklch ones.
- Running `npm run test:browser` while another Vite dev server is up on the same machine fails with "WebSocket closed without opened" (Vite's HMR port 24678 is taken). Run it alone.
- The error notice (`.notice[role="alert"]`) is now red on the muted grey, where the old theme showed every notice in green. Deliberate, for AA, but it reads louder than before.
- `listPaypalOrdersForUser` and `getPaypalOrder` deliberately do not select the new `refund_id` and `refunded_at` columns, so the live ledger keeps working before the migration is applied. Once it is applied, selecting them is safe.
- The `ccr-90064225-vddchi` branch is a leftover from the retired session (its PR #2 is merged).

## Refund design (server/webhook.js, 08e06b2)

- A verified `PAYMENT.CAPTURE.REFUNDED` names its capture only through the refund resource's `up` link (`.../v2/payments/captures/{id}`, PayPal Payments v2 "Show refund details"). `captureIdOfRefund` parses it; `getPaypalOrderByCaptureId` reads `paypal_payments` with the order embedded.
- The event is recorded for the drawer with the order and owner from that lookup. Then: no link, unknown capture, status not `COMPLETED`, or amount/currency not equal to the recorded capture (partial) answer 200 with `revoked: false` and a reason, since a PayPal retry could not change the outcome. A full refund calls `revoke_seat_access`; a repeat answers `alreadyRevoked`. A Supabase failure answers 5xx so PayPal retries.
- `revoke_seat_access(p_user_id, p_order_id, p_capture_id, p_refund_id, p_amount, p_currency)` locks the order row, checks owner, capture and amount, marks payment and order `REFUNDED`, records `refund_id` and `refunded_at`, deactivates `user_entitlements` only when the instructor has no other `COMPLETED` order, and returns `'revoked'` or `'already_revoked'`.
- Refunded state: ledger status `REFUNDED`, readiness "Seat revoked", `seatsRefunded` in the quota row and a REFUNDED column in Class seats; analytics status `Refunded` with `seatsRefunded` and `refundedAmount`; Studio measures Seats Refunded and Refunded.

## Ask AI code map

- `src/analytics/nvidiaAdapter.js`: browser-side AG Studio LLM adapter. Posts OpenAI Chat Completions-shaped bodies to `POST /api/studio-ai/chat`; decodes `{ id, model, message, finish_reason, usage }` replies. Reports busy state for the progress bar.
- `src/analytics/studioAgents.js`: AG Studio's five built-in agents with preloaded `view_report` / `view_schema` / `view_page`, no-recheck rules, the widget health rule, and one-sentence summaries. Lists the Seat agent in the lead's `delegate_to`.
- `src/analytics/seatAgent.js`: the Seat agent (custom Studio agent, id `seat`): posts the lead's instruction to `POST /api/agent/chat`, shows the reply, hands a proposal to the Confirm bar, reports back with `complete_task`.
- `src/analytics/widgets.jsx`: Revenue Tile, Seat Progress, Class Fill (`classFill.js` holds the row logic, unit tested). `initialReport.js`: the default report; `theme.js`: Studio theme on the brand tokens; `studioData.js`: data source and measures.
- `server/studioAi.js`: sign-in-only proxy. Validates Studio-only tools, translates to and from the Messages API, streams with the first-content retry (`completeAnthropicTurn`), drops thinking, logs per-turn rows when `STUDIO_AI_TIMING=1`. NVIDIA builders kept for the probe baseline and `time:ask-ai`.
- `server/anthropic.js`: Anthropic client (`ANTHROPIC_API_KEY`). `server/config.js`: models and effort. `scripts/check-strict-tools.mjs`, `scripts/probe-studio-agent.mjs`, `scripts/time-ask-ai.mjs`: as before.

### Decision: strict tools off (Eddie, 2026-10-31)

Tools are sent without `strict: true`. The live probe (Nov 2) measures tool-call validity per model; revisit strict only if it shows malformed calls. `npm run check:strict-tools` shows 6 of 21 captured Studio tools fail Anthropic's strict rules (recursive `$defs`, `not: {}`, `minItems`/`maxItems`, `minimum`) and the data, widget and page agents exceed the optional-param and union-param limits.

## Vercel deploy (live)

- `server/app.js`: the Express app, all `/api` routes. `server/index.js` adds the client and listens, for local use. `api/index.js`: the single Vercel Function; `vercel.json` rewrites `/api/:route*` to `/api?__route=:route*` and everything else to `/index.html`.
- Webhook raw body: `NODEJS_HELPERS=0` on Vercel so PayPal's postback verification gets the bytes as received.
- Env vars (Production, set): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`*, `PAYPAL_CLIENT_ID`*, `PAYPAL_SECRET`*, `PAYPAL_WEBHOOK_ID`*, `PAYPAL_BASE_URL`, `APP_BASE_URL`, `ANTHROPIC_API_KEY`* (pending), `NVIDIA_API_KEY`*, `NODEJS_HELPERS=0`; optional `STUDIO_AI_MODEL`, `STUDIO_AI_TIMING=1`. * = Secret. `.env.example` documents all of them.

## Remaining (in order)

1. Owner decisions 1 and 2 (refund migration and webhook event), then a live refund test.
2. Record the video from `DEMO-SCRIPT.md` (the Ask AI steps need the Anthropic key, the refund steps need item 1).
3. Live probe on Claude when the key arrives; pick model and effort.
4. AG Studio trial license (~Nov 5).
5. Right before submission: scrub git history of the old demo, old product names and cloudflared.deb, keeping commit dates (owner).
