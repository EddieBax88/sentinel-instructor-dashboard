# Handoff: Sentinel Instructor Dashboard (PayPal AI Hackathon)

Due Nov 12, 2026, 12:00pm PT. Judging Dec 1–15.

## Repo state

- Repo: `EddieBax88/sentinel-instructor-dashboard` (public). PR #1 (draft) is open against `main`. Never merge to `main` without Eddie.
- Branch: `ccr-1d301b90-3tuzmz`.
- Latest code commit: `0335ec7` (this file is committed on top of it).
- Tests: `npm test`, 73/73 pass. No network calls in tests.
- Node: `engines.node` is `>=22.12` (Supabase and openai packages need 22; Vite needs 22.12).
- No Vercel project exists for this repo yet.

## Hard rules

- No code or content from Sentinel's other products in this repo.
- Supabase: the hackathon project only (its URL is in local `.env`). Never touch the production project.
- Keys only in local `.env` (gitignored). Never print or commit keys. Secret scan before every push.
- Eddie runs SQL migrations himself in the Supabase SQL editor. Every migration must be safe to re-run and wrapped in one transaction.
- One task at a time. After each task: report commit hash, test count and exact steps for Eddie, then stop.

## Stack

Node/Express server + React/Vite client, Supabase (auth + Postgres), PayPal Sandbox, NVIDIA hosted API (OpenAI-compatible, `openai` SDK), AG Studio 3.0.0 with AG Grid pinned to 36.2.0. No AG Studio license yet (watermark is fine).

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

- `0335ec7`: widget agent told not to re-call `configure_widget` on health results (only on `success: false`); turns streamed with a 10 s first-chunk retry; `STUDIO_AI_TIMING` rows with `ttftMs` and `toolResults`. Tested against fakes and a local server with the real `openai` SDK only. Open risk: the proxy sends `stream_options: { include_usage: true }` to NVIDIA, untested there.
- `npm run time:ask-ai` (headless harness) hung on Eddie's machine before the 5-minute timeout was added in `77a5697`; not debugged.

## Ask AI code map

- `src/analytics/nvidiaAdapter.js`: browser-side AG Studio LLM adapter. Posts OpenAI Chat Completions-shaped bodies to `POST /api/studio-ai/chat`; decodes `{ id, model, message, finish_reason, usage }` replies. Reports busy state for the progress bar.
- `src/analytics/studioAgents.js`: AG Studio's five built-in agents with preloaded `view_report` / `view_schema` / `view_page`, no-recheck rules, the widget health rule, and one-sentence summaries.
- `server/studioAi.js`: sign-in-only proxy. Validates Studio-only tools, builds the model request, streams with the first-chunk retry (`completeTurn`), strips reasoning, logs per-turn rows when `STUDIO_AI_TIMING=1`.
- `server/config.js`: `AGENT_MODEL`, `AGENT_TEMPLATE_KWARGS` (shared by the seat agent and, today, Ask AI).
- `scripts/probe-studio-agent.mjs`: replays `scripts/fixtures/studio-agent-requests.json` (first turn of each Studio agent) against the model.
- `scripts/time-ask-ai.mjs` + `scripts/ask-ai-harness/`: times one question end to end in headless Chromium.

## Approved plan: Ask AI on Anthropic Claude (not built)

Decision: Ask AI moves from NVIDIA to Anthropic Claude via the native `@anthropic-ai/sdk`. The seat agent stays on NVIDIA. Anthropic API credits expected ~Nov 2.

Proxy changes (`server/studioAi.js`; the browser adapter and its request/response shape stay unchanged):

1. Client: `@anthropic-ai/sdk`, Messages API, streaming.
2. Request translation (incoming OpenAI-shaped body → Messages API):
   - System messages → top-level `system`.
   - Tool definitions → Anthropic `tools` (`name`, `description`, `input_schema`).
   - Assistant `tool_calls` in history → `tool_use` blocks.
   - `role: "tool"` results → `tool_result` blocks, all results of one round in a single user message.
   - `tool_choice`: forced choices (`tool` / `any`) become `auto` (forced choice returns 400 on Sonnet 5.5).
   - `response_format` (JSON schema) → `output_config.format`.
   - Drop `chat_template_kwargs`, `temperature`, `top_p` (non-default sampling returns 400 on Haiku 5.5 and Sonnet 5.5).
   - Thinking left on (model default); speed via `output_config.effort`, starting at `low`.
3. Strict tools: every tool sent with `strict: true`, and `additionalProperties: false` on every object in its schema. When building, check AG Studio's schemas (`$defs`/`$ref`, `anyOf`, optional properties) against the strict-mode schema rules in Anthropic's docs.
4. Turns with no tool call: return the text reply as a normal message with no `tool_calls` (Studio then ends or continues the run as it does today).
5. Refusals: no server-side fallback. `stop_reason: "refusal"` is returned to the browser as a clean error.
6. Response translation (Messages API → today's reply shape): text → `message.content`; `tool_use` blocks → `message.tool_calls` (arguments JSON-stringified); stop reason → `finish_reason` (`tool_use` → `tool_calls`, `max_tokens` → `length`, otherwise `stop`); usage → `usage`.
7. First-token retry kept: 10 s deadline, measured to the first content event (not `message_start`, which arrives at once); once content flows, never abort; one retry with no deadline.
8. `STUDIO_AI_TIMING` kept: agent, latency, `ttftMs`, input/output tokens from Messages usage, tools called, `toolResults`, retry fields. Thinking text is not returned by default, so the thinking-token estimate from text length no longer applies.

Probe changes (`scripts/probe-studio-agent.mjs`):

- Each setting gets a provider (NVIDIA or Anthropic) and runs through the same proxy request path as the app.
- Settings: `claude-haiku-5-5` effort `low` and `medium`; `claude-sonnet-5-5` effort `low` and `medium`; Ultra kept as baseline.
- Same pass check (valid tool call with required fields) and 5 agents × 2 trials.
- Anthropic settings skipped with a note when `ANTHROPIC_API_KEY` is unset.

Env vars:

- `ANTHROPIC_API_KEY` (new)
- `NVIDIA_API_KEY` (kept, for the seat agent)
- `STUDIO_AI_MODEL` (optional, new): picks the Claude model for Ask AI without a code change.

## Next task

Build the approved Anthropic plan against fakes (no live key yet): proxy translation, strict tools, no-tool-call turns, refusal error, streaming first-token retry, timing rows, probe settings. All tests must pass. Commit, push to `ccr-1d301b90-3tuzmz`, report commit hash, test count and run steps, then stop.

## Remaining after that (in order, one at a time)

1. Live probe and Ask AI timing on Claude once the key works; pick model and effort.
2. Hosted demo URL (free tier) + README setup/run instructions + test account details for judges.
3. Demo-video polish; clear test clutter (an old 30-seat pending order). Set the progress bar copy from measured timings.
4. Around Nov 5: AG Studio trial license key via env, served to the browser like the Supabase publishable key.
5. Right before submission: scrub git history of the old demo and old product names, keeping commit dates.
