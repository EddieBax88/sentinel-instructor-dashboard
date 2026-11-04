# Demo script (target: under 3 minutes)

Hosted demo: https://sentinel-hackathon-demo-mu.vercel.app. Everything runs on PayPal Sandbox; no real money moves.

Legend: **[KEY]** = needs `ANTHROPIC_API_KEY` set on Vercel (Ask AI and the Studio lead agent). **[WEBHOOK]** = the "Payment refunded" drawer entry needs `PAYMENT.CAPTURE.REFUNDED` on the PayPal webhook subscription; the refund itself and the seat revoke work without it. Steps without a tag work today.

## Before recording

1. Open a PayPal Sandbox **personal** (buyer) account's email and password from developer.paypal.com > Sandbox > Accounts; you sign in with it on PayPal's approval page.
2. Browser at 1440 px wide or more so the analytics report and the events drawer fit. Close other tabs' notifications.
3. Sign in with the demo account, then top bar **Reset demo data** > **Reset my demo data**, so the ledger starts empty (it deletes only that account's sandbox rows). Refresh the page.
4. Pick the theme for the recording in the top bar (**Black** is the default; **Industrial** and **Light** are one click away). The choice is remembered.

## Script

| Time | Say | Click |
|---|---|---|
| 0:00 | "Texas journeyman pass rate was 27.5% last fiscal year, and the state just moved to the 2026 NEC. Instructors buy class seats in bulk; this is the dashboard that sells, tracks and refunds them." | Overview page, signed in, ledger empty. Point at the line under the title: each seat unlocks Sentinel's NEC exam prep. |
| 0:12 | "Three themes, same tokens as our site." | Top bar: click **Industrial**, then **Black**. Everything re-colours, including the analytics charts later. |
| 0:20 | "I ask for seats in plain English. The chips are real requests." | In the **Seat assistant** panel click the chip **Buy 12 seats for my fall class**, then **Send**. The reply prices it: 12 × USD 49.00 = USD 588.00. |
| 0:35 | "Nothing has been ordered. The instructor confirms the amount." | Click **Confirm** in the proposal bar. |
| 0:45 | "PayPal Sandbox." | On PayPal's page sign in with the sandbox personal account, click **Pay Now** (or **Continue**). |
| 1:05 | "Back in the app the capture is confirmed server-side and the seats unlock." | The app returns to Overview; the notice reads "Payment captured. 12 seats unlocked for fall class." Seats remaining reads 18 / 30; the Transactions grid shows COMPLETED in green. |
| 1:15 | "Every PayPal webhook is signature-verified and shown live." | Top bar: **PayPal events**. The drawer lists "Payment captured" with the amount and order ID. Close it. |
| 1:25 | "Analytics are per instructor and built on AG Studio. Our custom Seat agent sits next to Studio's own agents." **[KEY]** | Sidebar: **Instructor analytics** > **Ask AI**. Click the chip **Buy 5 seats for the fall class** under the input, then send. Watch "Delegated to Seat agent", then the proposal bar above the report. Click **Dismiss** (or Confirm and pay again if time allows). |
| 1:50 | "Ask AI builds the report too." **[KEY]** | Click the chip **Revenue by class as a column chart**, send. The chart appears in about 15 seconds, in the current theme's palette. |
| 2:10 | "Refunds go through the same assistant, and the same human gate." | Sidebar **Overview**. Click the chip **Refund my last seat order**, then **Send**. The reply names the capture and amount; the red-edged bar shows **Capture … · 12 seats · USD 588.00 full refund**. |
| 2:25 | "Only this click moves money back." | Click **Confirm refund**. The chat says "Refund … issued for USD 588.00. 12 seats for fall class revoked." The grid shows REFUNDED in red, Student readiness says "Seat revoked", Seats remaining is back to 30 / 30. |
| 2:40 | "And the verified refund webhook lands in the drawer." **[WEBHOOK]** | Top bar: **PayPal events** shows "Payment refunded". |
| 2:50 | "Server-priced, human-confirmed, PayPal-captured, webhook-verified, revocable by the same assistant. That is the whole loop." | End on the Overview ledger. |

Without the key: skip 1:25 and 1:50; the Overview assistant covers the buy and the refund.

## If something stalls

- Ask AI turn takes much longer than 15 seconds: wait for the progress bar; the proxy retries a stalled turn once on its own. Do not resend.
- PayPal return page shows "Confirming capture…" for more than a few seconds: the capture endpoint is waiting on PayPal; the webhook path will unlock the seats even if the tab is closed.
- "Refund my last seat order" answers that there is no paid order: the last paid order was already refunded or none was captured yet. Buy first.
- Refund does not appear in the drawer within 10 seconds: PayPal webhooks can take up to a minute in Sandbox. Open the drawer again (it polls every 5 seconds while open). The seats are already revoked by the Confirm; the drawer entry only needs the webhook.
- Theme looks wrong after reload: the choice is stored in localStorage under `sentinel-dashboard-theme`; a private window starts on Black.

## After recording

Top bar **Reset demo data** again if the judges' account should start clean. It touches only that account's rows.

## Cut list if over time

Drop 1:50 (Ask AI chart) first, then 0:12 (themes), then 1:25 (Studio Seat agent). Keep buy, capture, events drawer, refund, revoke.
