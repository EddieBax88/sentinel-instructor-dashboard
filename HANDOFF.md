# Handoff: Sentinel Instructor Dashboard (PayPal AI Hackathon)

Due Nov 12, 2026, 12:00pm PT. Judging Dec 1–15.

## Repo state

- Repo: `EddieBax88/sentinel-instructor-dashboard` (public). PR #1 (draft) is open against `main`. Never merge to `main` without Eddie.
- Branch: `ccr-1d301b90-3tuzmz`. Head: `4ef6ad6` (Seat agent).
- Tests: `npm test`, 110/110 pass. No network calls in tests (one test runs the real Anthropic SDK against a local stub server). `npm run test:browser` runs the headless e2e tests (`e2e/`).
- Node: `engines.node` is `22.x` (Vercel deploys Node 26 for `>=22`; Supabase and openai need 22, Vite needs 22.12).
- Hosted demo: https://sentinel-hackathon-demo-mu.vercel.app (Vercel Hobby). The Vercel project's Production branch is `ccr-1d301b90-3tuzmz`; every push to it auto-deploys Production.
- Migrations: all five in `supabase/migrations` are applied to the hackathon Supabase project, including `seat_proposals` and `paypal_webhook_events` (as of Nov 1).
- PayPal sandbox webhook: verified live against the hosted demo (as of Nov 1).

## Hard rules

- No code or content from Sentinel's other products in this repo.
- Supabase: the hackathon project only (its URL is in local `.env`). Never touch the production project.
- Keys only in local `.env` (gitignored). Never print or commit keys. Secret scan before every push.
- Eddie runs SQL migrations himself in the Supabase SQL editor. Every migration must be safe to re-run and wrapped in one transaction.
- One task at a time. After each task: report commit hash, test count and exact steps for Eddie, then stop.

## Stack

Node/Express server + React/Vite client, Supabase (auth + Postgres), PayPal Sandbox, NVIDIA hosted API (OpenAI-compatible, `openai` SDK) for the seat agent, Anthropic Messages API (`@anthropic-ai/sdk` 1.3.0) for Ask AI, AG Studio 3.0.0 with AG Grid pinned to 36.2.0. No AG Studio license yet (watermark is fine).

## Verified working (on Eddie's machine unless noted)

- Seat agent (NVIDIA Nemotron 3 Ultra, `nvidia/nemotron-3-ultra-550b-a55b`): plain English → server-priced proposal → Confirm → PayPal Sandbox → capture → seats granted. Off-topic requests blocked server-side. Reasoning text stripped.
- Ledger and capture read from Supabase, scoped to the signed-in instructor. Idempotent.
- Migrations applied, in order: `20261027054700_paypal_orders_and_entitlements.sql`, `20261028150000_agent_actions_and_seat_quantity.sql`, `20261028200000_rename_seat_grant.sql`, `20261031180000_seat_proposals.sql`, `20261101200000_paypal_webhook_events.sql`.
- Hosted demo (`1fbccc9`): the API runs as one Vercel Function; seat proposals live in the Supabase `seat_proposals` table.
- Webhook (`45c32c2`): verified live on the hosted demo; verified events are recorded in `paypal_webhook_events`. Event drawer (`src/components/EventDrawer.jsx`, `GET /api/paypal/events`) verified with real events.
- Instructor analytics view (AG Studio): KPIs, charts, by-class grid, custom widgets, theme.
- Ask AI on Ultra (`5a216f7`): "Add a column chart of revenue by class" and "Add a pie chart of seats unlocked vs pending" both produced correct widgets. Progress bar shows and counts.
- Probe (`77a5697`, `npm run probe:studio-agent`), 5 Studio agents × 2 trials:
  - Ultra, thinking on: 10/10 valid tool calls, median turn 4.9 s.
  - Nemotron 3.5 Super VL (`nvidia/nemotron-3.5-super-vl-120b-a12b`), thinking on: 10/10, median 11.0 s.
  - Super 3.5 VL, thinking off: 10/10, median 10.4 s.
  - Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`): 404 "Function not found" on every call. The ID is still listed at `integrate.api.nvidia.com/v1/models`; the free hosted endpoint does not serve it.
- Pie-chart question timings: 13 turns ~126 s (`66cbbe0`); 13 turns ~102 s with the 15 s retry (`886510a`); with preloaded context (`95d61ed`) lead took 1 turn and page 2, but the widget agent called `configure_widget` twice (51.4 s and 73.1 s, both retried) and the run was stopped at 130 s+.
- Reproduced in headless AG Studio with a scripted model (this session): a correct pie `configure_widget` returns `success: true` and renders, but the health check still reports `data_mapping_complete` "not mapped" with score 0, and Studio's widget prompt says to re-call on health issues.

## Not yet verified live

- Seat agent (`4ef6ad6`, `src/analytics/seatAgent.js`): a custom AG Studio agent (id `seat`) the lead delegates seat requests to. It posts the lead's instruction to the existing `POST /api/agent/chat`, shows the reply, hands any proposal to the Confirm bar above the report, and reports back with `complete_task`. Covered by unit tests and `e2e/seatAgent.test.mjs` (scripted lead, real API routes, Confirm bar, PayPal redirect). The live lead-to-seat handoff through Claude is not yet checked; it waits on the Anthropic key (~Nov 2).
- Ask AI on Claude (built against fakes, no live key yet): proxy translation, streaming with 10 s first-content retry, refusal as a clean 422 error, timing rows, probe settings. Default model `claude-sonnet-5-5`, effort `low` (`server/config.js`) is a placeholder until the live probe.
- `0335ec7`: widget agent told not to re-call `configure_widget` on health results (only on `success: false`); turns streamed with a 10 s first-chunk retry; `STUDIO_AI_TIMING` rows with `ttftMs` and `toolResults`. Tested against fakes and a local server with the real `openai` SDK only. Open risk: the proxy sends `stream_options: { include_usage: true }` to NVIDIA, untested there.
- `npm run time:ask-ai` (headless harness) hung on Eddie's machine before the 5-minute timeout was added in `77a5697`; not debugged.

## Ask AI code map

- `src/analytics/nvidiaAdapter.js`: browser-side AG Studio LLM adapter. Posts OpenAI Chat Completions-shaped bodies to `POST /api/studio-ai/chat`; decodes `{ id, model, message, finish_reason, usage }` replies. Reports busy state for the progress bar.
- `src/analytics/studioAgents.js`: AG Studio's five built-in agents with preloaded `view_report` / `view_schema` / `view_page`, no-recheck rules, the widget health rule, and one-sentence summaries.
- `server/studioAi.js`: sign-in-only proxy. Validates Studio-only tools, translates to and from the Messages API, streams with the first-content retry (`completeAnthropicTurn`), drops thinking, logs per-turn rows when `STUDIO_AI_TIMING=1`. NVIDIA builders (`buildNvidiaRequest`, `completeTurn`) kept for the probe baseline and `time:ask-ai`.
- `src/analytics/seatAgent.js`: the Seat agent (above). `studioAgents.js` lists it in the lead's `delegate_to`.
- `server/anthropic.js`: Anthropic client (`ANTHROPIC_API_KEY`).
- `scripts/check-strict-tools.mjs`: offline strict-mode check of the captured Studio schemas.
- `server/config.js`: `AGENT_MODEL`, `AGENT_TEMPLATE_KWARGS` (shared by the seat agent and, today, Ask AI).
- `scripts/probe-studio-agent.mjs`: replays `scripts/fixtures/studio-agent-requests.json` (first turn of each Studio agent) against the model.
- `scripts/time-ask-ai.mjs` + `scripts/ask-ai-harness/`: times one question end to end in headless Chromium.

## Ask AI on Anthropic Claude (built against fakes)

Built per the approved plan in `server/studioAi.js` (`buildAnthropicRequest`, `toStudioReply`, `completeAnthropicTurn`, `describeAnthropicTurn`), `server/anthropic.js`, `server/config.js` and `scripts/probe-studio-agent.mjs`. The browser adapter and its request/response shape are unchanged. The NVIDIA proxy functions stay for the probe's baseline.

### Decision: strict tools off (Eddie, 2026-10-31)

Tools are sent without `strict: true`. The live probe (Nov 2) measures tool-call validity per model; revisit strict only if it shows malformed calls.

Why: the schema audit below. `npm run check:strict-tools` checks AG Studio's captured schemas against Anthropic's strict rules (structured-outputs docs, read 2026-10-31). Every object already has `additionalProperties: false`.

Rule failures (6 of 21 captured tools):

| Tool | Problem |
|---|---|
| `execute_query` | Recursive `$defs`, `not: {}`, `minItems`/`maxItems` 2 |
| `create_expression` | Recursive `$defs` |
| `create_plan` | Recursive layout `$defs` |
| `add_widget_filter` | `minItems`/`maxItems` 2 |
| `add_page_filter` | `minItems`/`maxItems` 2 |
| `configure_widget` | `minimum`, `exclusiveMinimum` |

Per-request limits (24 optional params, 16 union params, 20 strict tools):

| Agent | Tools | Optional params | Union params | Result |
|---|---|---|---|---|
| lead | 8 | 5 | 1 | Pass |
| data | 4 | 42 | 36 | Over both limits; 2 tools fail rules |
| widget | 7 | 186 | 31 | Over both limits; 2 tools fail rules |
| page | 9 | 24 (at limit) | 20 | Over union limit; 1 tool fails rules |
| planning | 6 | 9 | 7 | Within limits; 1 tool fails rules |

`update_expression` and `delete_expression` are on the allowlist but not in the captured fixtures, so they are unchecked.

`npm run time:ask-ai` still times the NVIDIA path; it was not part of the plan.

## Vercel deploy (live)

- `server/app.js`: the Express app, all `/api` routes; no Vite, no listener. `server/index.js` adds the client (Vite dev middleware, or `dist/` with `NODE_ENV=production`) and listens, for local use.
- `api/index.js`: the single Vercel Function. `vercel.json` rewrites `/api/:route*` to `/api?__route=:route*` (Vercel's rewrite docs show path params arriving as query params) and `api/index.js` rebuilds `/api/<route>` before Express routes it. Everything else rewrites to `/index.html`; files in `dist/` are served first.
- Seat proposals: Supabase table `seat_proposals` (10-minute expiry, server-only). Confirm claims the row with one DELETE (owner + not expired), so it works on any instance and only once.
- Webhook raw body: required. `verifySandboxWebhook` (`server/paypal.js`) posts the raw event bytes back to `/v1/notifications/verify-webhook-signature`, and PayPal's webhook docs (developer.paypal.com/api/rest/webhooks/rest/, "Postback method") say the event must be posted back exactly as received; re-serialized JSON can fail. So on Vercel set `NODEJS_HELPERS=0` (Vercel docs: functions/runtimes/node-js/advanced-node-configuration) so the body is not pre-parsed.

Vercel env vars (Production, set): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY`*, `PAYPAL_CLIENT_ID`*, `PAYPAL_SECRET`*, `PAYPAL_WEBHOOK_ID`*, `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`, `APP_BASE_URL` (the Vercel URL), `ANTHROPIC_API_KEY`*, `NVIDIA_API_KEY`*, `NODEJS_HELPERS=0`; optional `STUDIO_AI_MODEL`, `STUDIO_AI_TIMING=1`. * = mark as Secret.

## Next task

#4 Brand theme + Class fill widget + site link.

Also pending, not blocking: live probe and Ask AI timing on Claude once the Anthropic key works (~Nov 2); pick model and effort; check tool-call validity for the strict-tools decision; check the live lead-to-Seat-agent handoff.

## Remaining after that (in order, one at a time)

1. (Next task above.)
2. Repo hygiene for judges: README setup/run instructions and test account details; clear test clutter (an old 30-seat pending order); set the progress bar copy from measured timings; right before submission, scrub git history of the old demo and old product names, keeping commit dates.
3. #3 Refund -> seat revoke.
4. Demo video.

Also around Nov 5: AG Studio trial license key via env, served to the browser like the Supabase publishable key.
