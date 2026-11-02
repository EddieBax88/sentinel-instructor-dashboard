# Handoff: Sentinel Instructor Dashboard (PayPal AI Hackathon)

Due Nov 12, 2026, 12:00pm PT. Judging Dec 1–15.

## Repo state (Nov 2, 2026, end of the second unattended session)

- Repo: `EddieBax88/sentinel-instructor-dashboard` (public). Branch: `ccr-1d301b90-3tuzmz`. Vercel Production tracks this branch and auto-deploys every push. `GET /api/health` now reports the deployed commit (`VERCEL_GIT_COMMIT_SHA`), and every push below was checked that way.
- PR #1 (draft) is open against `main`. Never merge to `main` without Eddie. The judged README and LICENSE are the ones on `main` (see SUBMISSION.md checklist).
- Commits this session, oldest first (each pushed, deployed READY, health `ok` with that commit):
  - `f1333e0` Seat math: pending orders no longer reduce the seats remaining; header pill "N awaiting payment"; `/api/health` reports the commit.
  - `a863f9e` Triple theme: Black & Safety-Yellow (default), Industrial, Light; Studio re-themed through sRGB twins; AA contrast tests; browser test.
  - `4f323cc` Honest product context: STUDENT columns renamed CLASS; one product line under the hero.
  - `0bcbdeb` Judge prompt chips under the Seat assistant and Ask AI inputs.
  - `601f146` Agent-driven refund with a Confirm gate (direct Captures Refund API); Studio input colours fixed.
  - `f369688` Reset demo data (confirmed, sandbox-only, own rows only).
  - `172a8a8` Submission pack: SUBMISSION.md and the updated DEMO-SCRIPT.md.
  - This file's commit (final HANDOFF).
- Tests: `npm test` 162/162 (no network calls); `npm run test:browser` 3/3 (headless Chromium: themes and chips; refund chip to Confirm to sandbox refund to REFUNDED ledger to reset; Ask AI lead to Seat agent to Confirm to PayPal). Both browser harnesses now pick a free Vite HMR port, so they run together.
- Node: `engines.node` is `22.x`. `npm ci` is required on a fresh clone (the session container started without `node_modules`).
- Hosted demo: https://sentinel-hackathon-demo-mu.vercel.app (Vercel Hobby, project `sentinel-hackathon-demo`).
- Migrations applied to the hackathon Supabase project: the first five, plus (per the mission brief) `20261102000000_refunds_and_seat_revoke.sql`.
- Migration written, NOT applied: `20261103000000_refund_agent_actions.sql` (adds `refund_proposed`, `refund_issued`, `refund_failed`, `refund_rejected`, `demo_reset` to the `agent_actions` check). Until applied, those five actions are not logged (the server warns; the refund and the reset still work).
- PayPal sandbox webhook: `PAYMENT.CAPTURE.COMPLETED` verified live. `PAYMENT.CAPTURE.REFUNDED` still not on the subscription (owner decision 2). The Confirm-gated refund revokes seats itself when PayPal answers COMPLETED, so the demo works without it; the drawer's "Payment refunded" entry needs it.

## Owner decisions needed

1. **Apply `20261103000000_refund_agent_actions.sql`** in the hackathon project's SQL editor (one transaction, safe to re-run). Until then refund and reset actions are not written to `agent_actions`.
2. **Add `PAYMENT.CAPTURE.REFUNDED` to the PayPal sandbox webhook subscription** (developer.paypal.com > Apps & Credentials > the sandbox app > Webhooks > edit the `<demo URL>/api/paypal/webhook` subscription). The agent-driven refund already revokes seats on Confirm; this only adds the "Payment refunded" drawer entry and the webhook's alreadyRevoked path, both untested live.
3. **Live test the refund path** once: buy, then "Refund my last seat order" > Confirm, in the hosted demo with real sandbox credentials. Built and browser-tested against fakes only (this session had no PayPal access).
4. **Refund revoke timing.** The Confirm endpoint revokes seats immediately when PayPal answers COMPLETED and leaves a PENDING refund to the webhook. If you want webhook-only revoke, delete the `revokeSeatAccess` call in `refundSandboxCapture` (`server/paypal.js`); the tests in `server/refundCapture.test.js` then need the `revoked` expectations flipped.
5. **Demo reset is not one transaction.** It deletes table by table (entitlements, payments, orders, proposals, events, actions), each filtered to the signed-in user; a failure part-way is a 502 and a second click finishes. A single SQL function would be atomic but needs another migration; say if you want that.
6. **Judge test account.** Still none created or written anywhere. SUBMISSION.md says to put credentials in the form, not the repo.
7. **cloudflared.deb and the old names in history** (unchanged): the rewrite of `main` is yours.
8. **Logo** (unchanged): no asset in the repo; the sidebar keeps the GraduationCap mark.
9. **Theme defaults.** Black & Safety-Yellow is the default as briefed. The Light theme keeps `--primary-strong` for buttons and small text (AA); the dark themes use the raw primary everywhere because it already clears AA on their surfaces. The Industrial `--accent-soft` tint was darkened to `oklch(25% .035 45)` to keep primary text on it at 4.5:1.
10. **Delete the leftover branch `ccr-90064225-vddchi`** (PR #2 is merged).
11. **Anthropic key (~Nov 2) and AG Studio trial license (~Nov 5)**: unchanged from the previous handoff.

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

- **AG Studio and oklch (bigger than yesterday's chart finding).** Studio resolves theme colours in JavaScript (`getColorForVar` to `computedColorToHex`, accepting only `rgb()` and `color(srgb)`) not only for charts but for widget, canvas and inner-grid backgrounds and text. With oklch tokens, dark themes showed white widgets with white text. Every theme now emits `--srgb-*` hex twins and `src/analytics/theme.js` uses only those for colour params; `src/theme/themes.test.js` fails if a colour param points at an oklch token again.
- **Studio textarea colour.** Studio's AI textarea sets no colour and Studio fixed `color-scheme: light`, so typed text was black on the dark themes. Fixed with `browserColorScheme: 'inherit'` plus `.ag-studio-ai-assistant-textarea { color: var(--srgb-foreground) }`; the browser test asserts it.
- **Studio prompt starters removed.** They send on click; the mission wanted chips that fill the input. The Ask AI chips are React-portalled into Studio's input container (`.ag-studio-ai-assistant-input`), found by a MutationObserver. If a Studio upgrade renames that class the chips silently disappear; the browser test would catch it.
- **Refund test flake, fixed.** AG Grid re-renders a frame after the header; the ledger assertion now waits for the grid instead of reading once.
- **`seatsRemaining` semantics changed.** Pending orders no longer reduce it (that was the "0 / 30" bug). The seat agent's `get_current_seats` description says so; the agent tests were updated. `seatsReserved` is still reported separately.
- **Demo reset is deliberately a plain DELETE per table**, not an RPC, so it works before any new migration. See owner decision 5.
- AG Studio converts computed colors for AG Charts' canvas only from `rgb()` or `color(srgb)`. With oklch tokens the charts silently fell back to Studio's default blue/green palette; fixed by giving chart tokens sRGB hex values (`--chart-*`, `--chart-text`, `--chart-line` in `src/styles.css`). Any new Studio color param that reaches a chart must use those hex tokens, not the oklch ones.
- Running `npm run test:browser` while another Vite dev server is up on the same machine fails with "WebSocket closed without opened" (Vite's HMR port 24678 is taken). Run it alone.
- The error notice (`.notice[role="alert"]`) is now red on the muted grey, where the old theme showed every notice in green. Deliberate, for AA, but it reads louder than before.
- `listPaypalOrdersForUser` and `getPaypalOrder` deliberately do not select the new `refund_id` and `refunded_at` columns, so the live ledger keeps working before the migration is applied. Once it is applied, selecting them is safe.
- The `ccr-90064225-vddchi` branch is a leftover from the retired session (its PR #2 is merged).

## Research: @paypal/agent-toolkit for a refund-only tool (Nov 2, ~20 min)

Question: can `@paypal/agent-toolkit` be used for ONLY a refund tool without touching the working order path?

- **Yes, technically.** The README (npm `@paypal/agent-toolkit` 1.11.0, "Available tools" > "Payments") lists `create_refund`: "Process a refund for a captured payment." Its "Usage" section shows `configuration.actions` gating, and the bundle's action map has `payments: { createRefund: true }`, so a toolkit instance can expose only that tool. The implementation (`createRefund` in the bundle) posts to `${baseUrl}/v2/payments/captures/${capture_id}/refund`, the same Captures Refund API. It would run beside, not inside, the existing order code (`server/paypal.js`), which it would not touch.
- **Not low risk, so not used.** (1) It is built for model-invoked tool calling (zod schemas, `run(method, arg)` returning JSON strings for an LLM), while the brief requires a human Confirm, not a model call. (2) `dependencies` add 13 packages: `ai`, `openai@4.86.1` (this repo uses `openai` 7), `@langchain/core`, `@modelcontextprotocol/sdk`, `axios`, `mathjs`, `lodash`, `@dotenvx/dotenvx`, `@paypal/paypal-server-sdk`, and more. (3) Sandbox versus live is chosen by the toolkit's own `context.sandbox` (`baseUrl = sandbox ? api-m.sandbox.paypal.com : api-m.paypal.com`), outside this repo's hard guard that refuses any non-sandbox host. (4) It manages its own OAuth token separately from the server's token cache.
- **Decision:** call the Captures Refund API directly (`refundSandboxCapture` in `server/paypal.js`, ~40 lines) behind the existing sandbox guard, with a fixed `PayPal-Request-Id` for idempotency. The toolkit tarball was inspected in a scratch directory and never installed into the repo.

## Refund design (server/webhook.js, 08e06b2)

- A verified `PAYMENT.CAPTURE.REFUNDED` names its capture only through the refund resource's `up` link (`.../v2/payments/captures/{id}`, PayPal Payments v2 "Show refund details"). `captureIdOfRefund` parses it; `getPaypalOrderByCaptureId` reads `paypal_payments` with the order embedded.
- The event is recorded for the drawer with the order and owner from that lookup. Then: no link, unknown capture, status not `COMPLETED`, or amount/currency not equal to the recorded capture (partial) answer 200 with `revoked: false` and a reason, since a PayPal retry could not change the outcome. A full refund calls `revoke_seat_access`; a repeat answers `alreadyRevoked`. A Supabase failure answers 5xx so PayPal retries.
- `revoke_seat_access(p_user_id, p_order_id, p_capture_id, p_refund_id, p_amount, p_currency)` locks the order row, checks owner, capture and amount, marks payment and order `REFUNDED`, records `refund_id` and `refunded_at`, deactivates `user_entitlements` only when the instructor has no other `COMPLETED` order, and returns `'revoked'` or `'already_revoked'`.
- Refunded state: ledger status `REFUNDED`, readiness "Seat revoked", `seatsRefunded` in the quota row and a REFUNDED column in Class seats; analytics status `Refunded` with `seatsRefunded` and `refundedAmount`; Studio measures Seats Refunded and Refunded.

## This session's code map

- `src/theme/themes.js`: the three themes (oklch tokens, chart palette, status colours), `srgbTokens`, `chartTokens`, `themeCss`, `readStoredTheme`/`storeTheme` (try/catch), `applyTheme`. `scripts/build-theme-css.mjs` writes `src/theme-tokens.css` (committed; `npm run build:theme-css`). `src/theme/oklch.js`: oklch to sRGB and WCAG contrast. `index.html`: inline pre-paint script with the same storage key. `src/components/ThemeSwitcher.jsx`: the 3-segment control.
- `src/components/statusClass.js` + `.status-cell` pills in `SeatTable.jsx`; `--status-*` tokens per theme.
- `src/analytics/seatProgress.js`: Seat progress widget model (remaining = class size minus unlocked).
- `src/components/PromptChips.jsx`: chips; `AgentPanel.jsx` (`SEAT_CHIPS`, `REFUND_CHIP`), `InstructorAnalytics.jsx` (`ASK_AI_CHIPS`, portalled under Studio's input).
- Refund: `server/agent.js` `propose_refund` and `latestRefundableCapture`; `server/paypal.js` `refundSandboxCapture`; `POST /api/paypal/captures/:captureId/refund` in `server/app.js`; `src/components/RefundConfirmBar.jsx`; `src/analytics/seatAgent.js` `proposalArtifact`. Tests: `server/refundCapture.test.js`, `server/agent.test.js`, `e2e/dashboard.test.mjs`.
- Reset: `server/supabase.js` `resetDemoDataForUser` and `DEMO_RESET_TABLES`; `POST /api/demo/reset`; `src/components/ResetDemoButton.jsx`. Tests: `server/demoReset.test.js`, `e2e/dashboard.test.mjs`.
- `SUBMISSION.md`: Devpost fields and the Nov 5 checklist. `DEMO-SCRIPT.md`: updated click path.

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

1. Owner decisions 1 to 3 (agent-actions migration, refund webhook event, one live refund).
2. Record the video from `DEMO-SCRIPT.md` (the Ask AI steps need the Anthropic key).
3. Live probe on Claude when the key arrives; pick model and effort.
4. AG Studio trial license (~Nov 5).
5. Nov 5 early check from `SUBMISSION.md`.
6. Right before submission: scrub git history of the old demo, old product names and cloudflared.deb, keeping commit dates (owner).
