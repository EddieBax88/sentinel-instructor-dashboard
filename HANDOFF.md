# Handoff: Sentinel Instructor Dashboard (PayPal AI Hackathon)

Due Nov 12, 2026, 12:00pm PT. Judging Dec 1–15.

## Repo state (Nov 4, 2026, after the pre-video cleanup)

- Repo: `EddieBax88/sentinel-instructor-dashboard` (public). Branch: `ccr-1d301b90-3tuzmz`. Vercel Production tracks this branch and auto-deploys every push. `GET /api/health` now reports the deployed commit (`VERCEL_GIT_COMMIT_SHA`), and every push below was checked that way.
- **PR #1 is merged** (Nov 4, merge commit `94e634d`, a merge commit, not a squash, on Eddie's instruction). `main` now carries the full branch; `LICENSE` (MIT) is at its root and the GitHub API reports the repo license as `MIT`. The branch was kept: Vercel Production still deploys from it. Any further work goes on the branch and needs a new PR into `main`.
- **Devpost draft: complete except the video.** `SUBMISSION.md` holds every field; `DEMO-SCRIPT.md` is the click path.
- **cloudflared.deb and the old names stay in git history by decision** (Nov 4): no history rewrite, no force-push.
- Commits this session, oldest first (each pushed, deployed READY, health `ok` with that commit):
  - `f1333e0` Seat math: pending orders no longer reduce the seats remaining; header pill "N awaiting payment"; `/api/health` reports the commit.
  - `a863f9e` Triple theme: Black & Safety-Yellow (default), Industrial, Light; Studio re-themed through sRGB twins; AA contrast tests; browser test.
  - `4f323cc` Honest product context: STUDENT columns renamed CLASS; one product line under the hero.
  - `0bcbdeb` Judge prompt chips under the Seat assistant and Ask AI inputs.
  - `601f146` Agent-driven refund with a Confirm gate (direct Captures Refund API); Studio input colours fixed.
  - `f369688` Reset demo data (confirmed, sandbox-only, own rows only).
  - `172a8a8` Submission pack: SUBMISSION.md and the updated DEMO-SCRIPT.md.
  - `96d19ea` HANDOFF after the mission.
  - `8e73d5c` Class names group case-insensitively with one spelling (`fall class` and `Fall class` were splitting by-class charts and grids); Card 01's input is labelled "Class name"; Studio widget-picker icons use currentColor (the last hardcoded colour). Tests 164/164, browser 3/3.
  - `0f4e071` Six visual fixes from a full-screen check of the live deploy (see "Visual fixes, Nov 3" below). Tests 166/166, browser 6/6.
  - `dd21d87` The Ask AI model choice recorded from Eddie's live measurements (see "Ask AI live measurements, Nov 3" below); the Ask AI progress line now reads "Most questions take about 15 seconds."; SUBMISSION.md updated. Tests 166/166, browser 6/6.
  - `ea9353c` Pre-video cleanup (Nov 4): DEMO-SCRIPT.md says "in about 15 seconds"; README gained "How PayPal is used" (Orders v2, Payments v2, verified webhooks), names Claude Sonnet 5.5 for Ask AI and AG Grid / AG Charts / AG Studio together, and covers the Confirm-gated refund. README has no retired product names. Secret scan clean (only the fake test key and the docs that quote the pattern); `git log --all -- .env` empty. Tests 166/166, browser 6/6.
  - Nov 4, this commit: HANDOFF after the cleanup and the judge sign-up test (below).

## Judge sign-up test, Nov 4 (live site, headless Chromium)

- **Sign-up works with no email step.** `hackathon-signup-test@example.com` + an 8+ character password, "Create account": notice "Account created and signed in.", the checkout form swapped to the Class name input, the Seat assistant appeared, ledger empty (`No seat orders yet.`, 0 rows, Class seats 30 / 30). Signing in again with the same account also works. **Eddie removes this test user** (Supabase Auth > Users in the hackathon project).
- **The seat assistant did not answer.** The chip "Buy 12 seats for my fall class" filled the input; on send, `POST /api/agent/chat` hung and the Vercel Function hit "Task timed out after 300 seconds" (runtime errors, route `/api`, deployment of `ea9353c`, first at 01:19:49 UTC). Three sends over five minutes (01:19, 01:22, 01:23 UTC), all the same. The function logged nothing before the timeout, and `GET /api/ledger` for the same user answered normally, so the stall is in the NVIDIA call (`nvidia/nemotron-3-ultra-550b-a55b`), not Supabase or the app. The browser showed "Unexpected token 'u', "upstream r"... is not valid JSON" after 30 s: the test machine's outbound proxy gave up before Vercel did; from a normal browser the UI would spin for 5 minutes and then show a 504. No proposal screenshot exists because no proposal appeared. Confirm was never clicked.
- **Before the video:** try the chip from Eddie's browser. If it still hangs, check the NVIDIA key on build.nvidia.com (developer-forum threads from this week report free Build API accounts turned to 403/404 after an account-verification change; a hang is different, but the key is the first thing to rule out), and consider a client timeout on the seat agent's `openai` call (`server/agent.js` has none; the SDK default is 10 minutes, longer than Vercel's 300 s) so a stuck upstream returns a clean error instead of a 504.
- Tests: `npm test` 166/166 (no network calls); `npm run test:browser` 6/6 (the 3 below plus `e2e/layout.test.mjs`: class-name input, layout at 1440/1920 in all three themes, pills at 1024) (headless Chromium: themes and chips; refund chip to Confirm to sandbox refund to REFUNDED ledger to reset; Ask AI lead to Seat agent to Confirm to PayPal). Both browser harnesses now pick a free Vite HMR port, so they run together.
- Node: `engines.node` is `22.x`. `npm ci` is required on a fresh clone (the session container started without `node_modules`).
- Hosted demo: https://sentinel-hackathon-demo-mu.vercel.app (Vercel Hobby, project `sentinel-hackathon-demo`).
- Migrations applied to the hackathon Supabase project: the first five, plus (per the mission brief) `20261102000000_refunds_and_seat_revoke.sql`.
- Migration written, NOT applied: `20261103000000_refund_agent_actions.sql` (adds `refund_proposed`, `refund_issued`, `refund_failed`, `refund_rejected`, `demo_reset` to the `agent_actions` check). Until applied, those five actions are not logged (the server warns; the refund and the reset still work).
- PayPal sandbox webhook: `PAYMENT.CAPTURE.COMPLETED` verified live. `PAYMENT.CAPTURE.REFUNDED` still not on the subscription (owner decision 2). The Confirm-gated refund revokes seats itself when PayPal answers COMPLETED, so the demo works without it; the drawer's "Payment refunded" entry needs it.

## Ask AI live measurements, Nov 3

Measured by Eddie on production from the `STUDIO_AI_TIMING` log rows. Effort `low` for both models.

| Model | Request | Model turns | Failed tool calls | Per turn | End to end | Result |
|---|---|---|---|---|---|---|
| `claude-sonnet-5-5` | "Add a column chart of revenue by class." | 7 | 0 | 0.8 to 2.5 s | about 15 s | Chart rendered correctly (Fall class, $294). |
| `claude-sonnet-5-5` | "Buy 5 seats for the fall class" | not recorded | not recorded | not recorded | about 14 s, roughly 10 s of it the NVIDIA seat assistant | The lead delegated to the Seat agent with `delegate_to`; the Confirm bar showed 5 seats, Fall class, USD 245.00 total; the lead's final reply said nothing was ordered or paid until Confirm. |
| `claude-haiku-5-5` | "Add a column chart of revenue by class." | 9 | 2 | not recorded | about 15 s | Recovered and rendered. Failures: a `delegate_to` with no target agent (the empty "Delegated to" row showed red in the UI) and a `configure_widget` "Expected an object" error. |

- **Decision:** Sonnet 5.5 at effort `low` (`server/config.js`). Effort `medium` was not tested, because `low` already had 0 failed tool calls.
- `STUDIO_AI_MODEL` has been removed from Vercel, so production uses the code default.

## Visual fixes, Nov 3 (root causes)

1. **Status pill narrower than its text** (`src/styles.css` `.status-cell`, `src/components/SeatTable.jsx`). The pill had `max-width: 100%` and no `white-space` of its own; it inherited `nowrap` from AG Grid's `.ag-cell`. When the pill's natural width passed the cell's content box, the background was clamped to the box while the text ran on. Measured: at the PAYMENT STATUS minimum of 150px the content box is 118px and AWAITING PAYMENT needs 118.3px (headless Linux Chromium; macOS text renders a little wider, so it shows more there). Now `inline-flex`, `width: max-content`, own `nowrap`, centred, no max-width; PAYMENT STATUS `minWidth` 180 so the widest pill always fits inside the cell.
2. **Class seats empty box** (`SeatTable.jsx`). The grids use `domLayout="autoHeight"`, and AG Grid 36's theme default `autoHeightMinBodyHeight` is 150px, so a one-row grid was 183px tall. Now `autoHeightMinBodyHeight: 0` (an empty ledger shows `.grid-empty`) and `autoHeightMaxBodyHeight: 340` (10 rows, then the grid scrolls). Applies to all three ledger grids.
3. **Class name showed the instructor email** (`src/App.jsx`). Nothing in the app ever put the email in that state (`studentName` starts as `''`). The sign-in form and the checkout form sat in the same JSX slot with an `<input>` in the same position, so React reused the sign-in email `<input>` DOM node as the class name input. On a page load the sign-in form renders first (the session arrives a moment later), a browser password manager autofills the email into it without telling React, and the reused node kept the email. The browser test proves the reuse (a marker set on the email node was still on `#class-name`). Fix: `key="sign-in"` / `key="checkout"` so the class input is a fresh node; Card 01 prefills with the class of the newest ledger order (`src/components/latestClassName.js`, skips anything that looks like an email), otherwise empty with placeholder "Class name"; once the instructor types, the 3-second poll never overwrites it.
4. **Sidebar "Seat ledger" link removed** (`App.jsx`). Nothing else used it: no test, chip, doc or link pointed at `#seat-ledger` (the section keeps its id, harmless).
5. **"Awaiting payment" label pushed its number down** (`styles.css` `.studio-seats`). The `dl` was 4 equal `minmax(0, 1fr)` columns with each `dd` in normal flow under its `dt`, so the longest label wrapped (2 lines headless, 3 on Eddie's screen) and its number dropped. Now the labels share one grid row and the numbers the next (`grid-template-rows: subgrid`), columns take their content width (`repeat(4, auto)`, `justify-content: space-between`), so labels sit on one line when there is room and numbers always share a baseline. Theme-independent CSS; tested in all three themes.
6. **"Seats Pendi…" in Orders by class** (`src/analytics/initialReport.js`, `styles.css`). Studio builds this grid's column defs itself and sizes columns with `autoSizeAllColumns({ scaleUpToFitGridWidth: true })` and `autoSizePadding: 0`. When the columns' natural widths fill the grid (a long class name does it), no scale-up happens and each header gets exactly its rounded text width; a text width of 70.11px in a 70px box gets AG Grid's ellipsis (reproduced: "Seats Order…"), and the last column ran off the grid. Report state cannot set `minWidth`/`flex` (Studio rebuilds the colDefs and re-autosizes on every layout change; the widget's format schema only has `columnWidth`, `columnAutoSize`, `headerRow.wrapText`). So the fix is the grid widget's own setting `format.style.headerRow.wrapText: true`, which sets `wrapHeaderText` + `autoHeaderHeight` on every column and autosizes to cell content. One CSS rule was still needed: AG Grid keeps the sort arrow on the text line, so the sorted Revenue header broke mid-word ("Reven/ue"); the header label may now wrap the arrow to its own line, and header words never shrink below themselves. The test's fixture uses a long class name on purpose.

## Owner decisions needed

1. **Apply `20261103000000_refund_agent_actions.sql`** in the hackathon project's SQL editor (one transaction, safe to re-run). Until then refund and reset actions are not written to `agent_actions`.
2. **Add `PAYMENT.CAPTURE.REFUNDED` to the PayPal sandbox webhook subscription** (developer.paypal.com > Apps & Credentials > the sandbox app > Webhooks > edit the `<demo URL>/api/paypal/webhook` subscription). The agent-driven refund already revokes seats on Confirm; this only adds the "Payment refunded" drawer entry and the webhook's alreadyRevoked path, both untested live.
3. **Live test the refund path** once: buy, then "Refund my last seat order" > Confirm, in the hosted demo with real sandbox credentials. Built and browser-tested against fakes only (this session had no PayPal access).
4. **Refund revoke timing.** The Confirm endpoint revokes seats immediately when PayPal answers COMPLETED and leaves a PENDING refund to the webhook. If you want webhook-only revoke, delete the `revokeSeatAccess` call in `refundSandboxCapture` (`server/paypal.js`); the tests in `server/refundCapture.test.js` then need the `revoked` expectations flipped.
5. **Demo reset is not one transaction.** It deletes table by table (entitlements, payments, orders, proposals, events, actions), each filtered to the signed-in user; a failure part-way is a 502 and a second click finishes. A single SQL function would be atomic but needs another migration; say if you want that.
6. **Judge test account.** Still none created or written anywhere. SUBMISSION.md says to put credentials in the form, not the repo.
7. **cloudflared.deb and the old names in history: stay by decision** (Nov 4). No rewrite, no force-push.
8. **Logo** (unchanged): no asset in the repo; the sidebar keeps the GraduationCap mark.
9. **Theme defaults.** Black & Safety-Yellow is the default as briefed. The Light theme keeps `--primary-strong` for buttons and small text (AA); the dark themes use the raw primary everywhere because it already clears AA on their surfaces. The Industrial `--accent-soft` tint was darkened to `oklch(25% .035 45)` to keep primary text on it at 4.5:1.
10. **Delete the leftover branch `ccr-90064225-vddchi`** (PR #2 is merged). Tried Nov 4 from the cloud session: both `git push origin --delete` and the GitHub API delete are refused by the session's proxy (write to that path not permitted). Delete it from GitHub > Branches, or locally with `git push origin --delete ccr-90064225-vddchi`.
11. **Anthropic key: done** (in Vercel Production; Ask AI measured live Nov 3). **AG Studio trial license (~Nov 5)**: unchanged from the previous handoff.

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
- Ask AI on Claude (Nov 3, production): Sonnet 5.5 at effort `low` built a revenue-by-class column chart through Studio's tools in 7 turns with 0 failed tool calls; the `STUDIO_AI_TIMING` rows are logged. See "Ask AI live measurements, Nov 3".
- Studio lead hands seat requests to the Seat agent (Nov 3, production, live Claude lead): `delegate_to` the Seat agent, Confirm bar with 5 seats, Fall class, USD 245.00 total; the lead's reply says nothing is ordered or paid until Confirm.
- Earlier probe results and Ask AI timings on NVIDIA are unchanged from the previous handoff (Ultra 10/10 valid tool calls, median 4.9 s; Nemotron 3.5 Super VL 10/10, 11.0 s; Nemotron 3 Super 404 on the free endpoint).

## Not yet verified live

- Refund to seat revoke (see Owner decisions 1 and 2).
- Ask AI on Claude: the 10 s first-content retry and a refusal as a clean 422 are tested against fakes only; the Nov 3 runs did not report either.
- `npm run time:ask-ai` (headless harness) hung on Eddie's machine before the 5-minute timeout was added; not debugged. Still times the NVIDIA path.

## Things that looked worse or need a second look

- **Visual fixes not checked on Eddie's Mac.** The pill overflow and the header truncation reproduce in headless Linux Chromium only at tighter widths or with sub-pixel text; the Mac shows them at full width. Worth one look at the live demo in Safari and Chrome on the Mac after this deploy.
- **Long class names truncate in cells** (not headers): Orders by class and the Transactions CLASS column end a long name with "…". Unchanged by this fix; say if you want wrapping there too.

- **AG Studio and oklch (bigger than yesterday's chart finding).** Studio resolves theme colours in JavaScript (`getColorForVar` to `computedColorToHex`, accepting only `rgb()` and `color(srgb)`) not only for charts but for widget, canvas and inner-grid backgrounds and text. With oklch tokens, dark themes showed white widgets with white text. Every theme now emits `--srgb-*` hex twins and `src/analytics/theme.js` uses only those for colour params; `src/theme/themes.test.js` fails if a colour param points at an oklch token again.
- **Studio textarea colour.** Studio's AI textarea sets no colour and Studio fixed `color-scheme: light`, so typed text was black on the dark themes. Fixed with `browserColorScheme: 'inherit'` plus `.ag-studio-ai-assistant-textarea { color: var(--srgb-foreground) }`; the browser test asserts it.
- **Studio prompt starters removed.** They send on click; the mission wanted chips that fill the input. The Ask AI chips are React-portalled into Studio's input container (`.ag-studio-ai-assistant-input`), found by a MutationObserver. If a Studio upgrade renames that class the chips silently disappear; the browser test would catch it.
- **Refund test flake, fixed.** AG Grid re-renders a frame after the header; the ledger assertion now waits for the grid instead of reading once.
- **`seatsRemaining` semantics changed.** Pending orders no longer reduce it (that was the "0 / 30" bug). The seat agent's `get_current_seats` description says so; the agent tests were updated. `seatsReserved` is still reported separately.
- **Class name spelling is decided at read time** (`canonicalClassNames` in `server/seatUnlock.js`): stored rows keep their text; the ledger, analytics rows, refund proposals and PayPal notes show the most frequent spelling per case-insensitive key. New orders are tidied at write time (`tidyClassName`: trim, collapse spaces, capitalise the first letter). Nothing in Supabase was rewritten.
- **Hardcoded-accent audit:** `src/styles.css` has no colour literals; logo badge, active nav, the "01" circle, the LIVE dot and the PAYPAL SANDBOX pill all use `--primary` / `--primary-strong` / `--accent-soft`. The only literal was the widget-picker SVG stroke in `widgets.jsx`, now `currentColor`.
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

Tools are sent without `strict: true`. Live on Nov 3, the chosen model (Sonnet 5.5) made 0 failed tool calls, so this stands. `npm run check:strict-tools` shows 6 of 21 captured Studio tools fail Anthropic's strict rules (recursive `$defs`, `not: {}`, `minItems`/`maxItems`, `minimum`) and the data, widget and page agents exceed the optional-param and union-param limits.

## Vercel deploy (live)

- `server/app.js`: the Express app, all `/api` routes. `server/index.js` adds the client and listens, for local use. `api/index.js`: the single Vercel Function; `vercel.json` rewrites `/api/:route*` to `/api?__route=:route*` and everything else to `/index.html`.
- Webhook raw body: `NODEJS_HELPERS=0` on Vercel so PayPal's postback verification gets the bytes as received.
- Env vars (Production, set): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`*, `PAYPAL_CLIENT_ID`*, `PAYPAL_SECRET`*, `PAYPAL_WEBHOOK_ID`*, `PAYPAL_BASE_URL`, `APP_BASE_URL`, `ANTHROPIC_API_KEY`*, `NVIDIA_API_KEY`*, `NODEJS_HELPERS=0`; optional `STUDIO_AI_TIMING=1`. `STUDIO_AI_MODEL` was removed on Nov 3, so production uses the code default in `server/config.js`. * = Secret. `.env.example` documents all of them.

## Remaining (in order)

Done: the Anthropic key and the live probe on Claude (Nov 3; Sonnet 5.5, effort `low`); PR #1 merged into `main` with LICENSE confirmed MIT (Nov 4); README judge checklist, DEMO-SCRIPT timing, secret scan (Nov 4); Devpost draft complete except the video.

1. **Seat assistant on the live site:** confirm the chip answers from Eddie's browser (see "Judge sign-up test, Nov 4"). The video's seat-assistant steps depend on it.
2. Record the video from `DEMO-SCRIPT.md`, upload, paste the link into `SUBMISSION.md`.
3. Delete the test user `hackathon-signup-test@example.com` and the leftover branch `ccr-90064225-vddchi` (owner decision 10).
4. Owner decisions 1 to 3 (agent-actions migration, refund webhook event, one live refund).
5. AG Studio trial license (~Nov 5).
6. Right before submission: scrub git history of the old demo, old product names and cloudflared.deb, keeping commit dates (owner).
