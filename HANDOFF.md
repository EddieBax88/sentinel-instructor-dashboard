# Handoff: Sentinel Instructor Dashboard (PayPal AI Hackathon)

Due Nov 12, 2026, 12:00pm PT. Judging Dec 1–15.

## Repo state

- Repo: `EddieBax88/sentinel-instructor-dashboard` (public). PR #1 (draft) is open against `main`. Never merge to `main` without Eddie.
- Branch: `ccr-1d301b90-3tuzmz`.
- Latest code commit: the "Ask AI on Anthropic Claude" commit (this file is updated in it).
- Tests: `npm test`, 86/86 pass. No network calls in tests (one test runs the real Anthropic SDK against a local stub server).
- Node: `engines.node` is `>=22.12` (Supabase and openai packages need 22; Vite needs 22.12).
- No Vercel project exists for this repo yet.

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
- Migrations run, in order: `20261027054700_paypal_orders_and_entitlements.sql`, `20261028150000_agent_actions_and_seat_quantity.sql`, `20261028200000_rename_seat_grant.sql`.
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

- Ask AI on Claude (built against fakes, no live key yet): proxy translation, streaming with 10 s first-content retry, refusal as a clean 422 error, timing rows, probe settings. Default model `claude-sonnet-5-5`, effort `low` (`server/config.js`) is a placeholder until the live probe.
- `0335ec7`: widget agent told not to re-call `configure_widget` on health results (only on `success: false`); turns streamed with a 10 s first-chunk retry; `STUDIO_AI_TIMING` rows with `ttftMs` and `toolResults`. Tested against fakes and a local server with the real `openai` SDK only. Open risk: the proxy sends `stream_options: { include_usage: true }` to NVIDIA, untested there.
- `npm run time:ask-ai` (headless harness) hung on Eddie's machine before the 5-minute timeout was added in `77a5697`; not debugged.

## Ask AI code map

- `src/analytics/nvidiaAdapter.js`: browser-side AG Studio LLM adapter. Posts OpenAI Chat Completions-shaped bodies to `POST /api/studio-ai/chat`; decodes `{ id, model, message, finish_reason, usage }` replies. Reports busy state for the progress bar.
- `src/analytics/studioAgents.js`: AG Studio's five built-in agents with preloaded `view_report` / `view_schema` / `view_page`, no-recheck rules, the widget health rule, and one-sentence summaries.
- `server/studioAi.js`: sign-in-only proxy. Validates Studio-only tools, translates to and from the Messages API, streams with the first-content retry (`completeAnthropicTurn`), drops thinking, logs per-turn rows when `STUDIO_AI_TIMING=1`. NVIDIA builders (`buildNvidiaRequest`, `completeTurn`) kept for the probe baseline and `time:ask-ai`.
- `server/anthropic.js`: Anthropic client (`ANTHROPIC_API_KEY`).
- `scripts/check-strict-tools.mjs`: offline strict-mode check of the captured Studio schemas.
- `server/config.js`: `AGENT_MODEL`, `AGENT_TEMPLATE_KWARGS` (shared by the seat agent and, today, Ask AI).
- `scripts/probe-studio-agent.mjs`: replays `scripts/fixtures/studio-agent-requests.json` (first turn of each Studio agent) against the model.
- `scripts/time-ask-ai.mjs` + `scripts/ask-ai-harness/`: times one question end to end in headless Chromium.

## Ask AI on Anthropic Claude (built against fakes)

Built per the approved plan in `server/studioAi.js` (`buildAnthropicRequest`, `toStudioReply`, `completeAnthropicTurn`, `describeAnthropicTurn`), `server/anthropic.js`, `server/config.js` and `scripts/probe-studio-agent.mjs`. The browser adapter and its request/response shape are unchanged. The NVIDIA proxy functions stay for the probe's baseline.

One plan item not built: strict tools. `npm run check:strict-tools` checks AG Studio's captured schemas against Anthropic's strict rules (structured-outputs docs, read 2026-10-31). Every object already has `additionalProperties: false`, but:

- Rule failures: `execute_query` (recursive `$defs`, `not: {}`, `minItems`/`maxItems` 2), `create_expression` (recursive), `create_plan` (recursive layout `$defs`), `add_widget_filter` and `add_page_filter` (`minItems`/`maxItems` 2), `configure_widget` (`minimum`, `exclusiveMinimum`).
- Per-request limits (24 optional params, 16 union params): data agent 42/36, widget agent 186/31, page agent 24/20. Only the lead agent passes everything.
- `update_expression` and `delete_expression` are on the allowlist but not in the captured fixtures, so they are unchecked.

Tools are sent without `strict: true` until Eddie decides how to handle this.

`npm run time:ask-ai` still times the NVIDIA path; it was not part of the plan.

## Next task

Eddie decides on strict tools (see above). Then the live probe and Ask AI timing on Claude once the key works; pick model and effort.

## Remaining after that (in order, one at a time)

1. (Next task above.)
2. Hosted demo URL (free tier) + README setup/run instructions + test account details for judges.
3. Demo-video polish; clear test clutter (an old 30-seat pending order). Set the progress bar copy from measured timings.
4. Around Nov 5: AG Studio trial license key via env, served to the browser like the Supabase publishable key.
5. Right before submission: scrub git history of the old demo and old product names, keeping commit dates.
