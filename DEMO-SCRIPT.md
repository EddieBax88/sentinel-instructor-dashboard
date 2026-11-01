# Demo script (target: under 3 minutes)

Hosted demo: https://sentinel-hackathon-demo-mu.vercel.app. Everything runs on PayPal Sandbox; no real money moves.

Legend: **[KEY]** = needs `ANTHROPIC_API_KEY` set on Vercel (Ask AI and the Studio lead agent). **[MIGRATION]** = needs `supabase/migrations/20261102000000_refunds_and_seat_revoke.sql` applied and `PAYMENT.CAPTURE.REFUNDED` added to the PayPal webhook subscription. Steps without a tag work today.

## Before recording

1. Open a PayPal Sandbox **personal** (buyer) account's email and password from developer.paypal.com > Sandbox > Accounts; you sign in with it on PayPal's approval page.
2. Have the Sandbox **business** account (the one the app's REST credentials belong to) open in a second tab at https://www.sandbox.paypal.com, signed in, on **Activity**, for the refund. **[MIGRATION]**
3. Browser at 1440 px wide or more so the analytics report and the events drawer fit. Close other tabs' notifications.
4. Use the account you will demo with: a fresh account keeps the ledger clean; an existing one shows history in the charts.

## Script

| Time | Say | Click |
|---|---|---|
| 0:00 | "Texas journeyman pass rate was 27.5% last fiscal year. Instructors buy class seats in bulk; this is the dashboard that sells and tracks them." | Overview page, already open. |
| 0:10 | "Sign in." | Type email and password in the checkout band, click **Sign in** (or **Create account** for a new one). The notice reads "Signed in." |
| 0:20 | "Analytics are per instructor and built on AG Studio." | Sidebar: **Instructor analytics**. Point at Revenue, Seats unlocked vs pending, Class fill, Orders by class. |
| 0:30 | "I ask for seats in plain English." **[KEY]** | Click **Ask AI** (top right of the report). In the assistant textarea type `buy 5 seats for fall` and press the send button. The progress bar reads "Analytics assistant is working…". |
| 0:45 | "Studio's lead agent hands the request to our custom Seat agent, which calls the same seat assistant the Overview page uses." **[KEY]** | Watch the chat: "Delegated to Seat agent", then the reply with the server-priced proposal (5 × USD 49.00 = USD 245.00). |
| 0:55 | "Nothing has been ordered. The instructor confirms the amount." | The **Seat agent prepared an order** bar appears above the report. Click **Confirm and pay with PayPal**. |
| | *Without the key:* same outcome from the Overview page: sidebar **Overview**, in the **Seat assistant** panel type `buy 5 seats for fall`, click **Send**, then **Confirm**. | |
| 1:05 | "PayPal Sandbox." | On PayPal's page sign in with the sandbox personal account, click **Pay Now** (or **Continue**). |
| 1:25 | "Back in the app the capture is confirmed server-side and the seats unlock." | The app returns to Overview; the notice reads "Payment captured. 5 seats unlocked for fall." Seats remaining and the ledger grids update. |
| 1:35 | "Every PayPal webhook is signature-verified and shown live." | Top bar: **PayPal events**. The drawer lists "Payment captured" with the amount and order ID (and "Order approved" if PayPal sent it). Close it. |
| 1:50 | "Ask AI can build the report too." **[KEY]** | Sidebar **Instructor analytics** > **Ask AI**. Type `Add a column chart of revenue by class` and send. The chart appears on the canvas in 10 to 25 seconds. |
| 2:15 | "A refund in PayPal revokes the seats automatically." **[MIGRATION]** | Second tab (sandbox business account, **Activity**): open the USD 245.00 payment, click **Issue a refund**, leave the full amount, click **Issue Refund**. |
| 2:35 | "The webhook resolved the capture, checked it was a full refund, and revoked." **[MIGRATION]** | Back in the app: **PayPal events** shows "Payment refunded"; the Transactions grid shows the order as REFUNDED, Student readiness says "Seat revoked", Class seats shows 5 under REFUNDED. |
| 2:50 | "Server-priced, human-confirmed, PayPal-captured, webhook-verified, revocable. That is the whole loop." | End on the Overview ledger. |

## If something stalls

- Ask AI turn takes longer than 25 seconds: wait for the progress bar; the proxy retries a stalled turn once on its own. Do not resend.
- PayPal return page shows "Confirming capture…" for more than a few seconds: the capture endpoint is waiting on PayPal; the webhook path will unlock the seats even if the tab is closed.
- Refund does not appear in the drawer within 10 seconds: PayPal webhooks can take up to a minute in Sandbox. Open the drawer again (it polls every 5 seconds while open).
- Sandbox refund option missing in Activity: use the API instead: `POST https://api-m.sandbox.paypal.com/v2/payments/captures/{capture_id}/refund` with an empty JSON body `{}` and the business app's bearer token; an empty body refunds the full amount.

## Cut list if over time

Drop step 1:50 (Ask AI chart) first, then step 0:20 (the analytics tour). Keep sign in, buy, capture, events drawer, refund.
