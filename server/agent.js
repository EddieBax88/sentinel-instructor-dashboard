import { randomUUID } from 'node:crypto';
import { AGENT_REQUEST_BUDGET_MS, MAX_SEATS_PER_ORDER, MODEL_CALL_TIMEOUT_MS, STUDIO_AI_EFFORT, studioAiModel } from './config.js';
import { anthropicClient, isAnthropicConfigured } from './anthropic.js';
import { assertSeatQuantity, createSandboxOrder, SEAT_PRICING, seatOrderTotal } from './paypal.js';
import { COHORT, dashboardFromOrders } from './seatUnlock.js';
import { claimSeatProposal, getSeatProposal, listPaypalOrdersForUser, logAgentAction, saveSeatProposal } from './supabase.js';
import { canonicalClassNames, money, tidyClassName } from './seatUnlock.js';

const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const MAX_TOOL_ROUNDS = 6;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;
// Replies are under 60 words; the cap leaves room for low-effort thinking and the tool calls.
const MAX_OUTPUT_TOKENS = 4096;
export const OFF_TOPIC_REPLY = 'I can only help with seat pricing, seat availability, and buying cohort seats.';
export const TIMEOUT_REPLY = 'The seat assistant took too long. Please try again.';
const SEAT_TOPIC = /\b(seats?|orders?|ordering|buy|buying|purchas\w*|pric\w*|costs?|totals?|class(es)?|cohorts?|students?|enroll\w*|checkout|paypal|pay|payment|confirm\w*|cancel\w*|availab\w*|quantity|how many|refund\w*|money back)\b/i;
const MAX_FOLLOW_UP_WORDS = 8;

const SYSTEM_PROMPT = `You are the seat-purchasing assistant on the Sentinel instructor dashboard. A signed-in instructor uses you to buy seats in their cohort through PayPal Sandbox.

You can do four things: report seat pricing, report seat availability and the instructor's own seat orders, prepare a seat order for the instructor to confirm, and propose a refund of the instructor's most recent paid seat order for the instructor to confirm. If a request is about anything else, decline in one sentence and say what you can help with. Do not answer general questions, write other content, or discuss other products.

When the instructor asks to buy seats, call get_seat_pricing and get_current_seats, then call create_seat_order with the quantity and a short class name. If they did not give a quantity, ask for one; you may suggest the default class size from get_current_seats. Quantity must be a whole number from 1 to ${MAX_SEATS_PER_ORDER}.

create_seat_order does not charge anything or create a PayPal order. It prepares a proposal, and nothing is ordered until the instructor clicks Confirm on the dashboard. After it succeeds, state the quantity, unit price, and total from the tool result and tell the instructor to click Confirm to continue to PayPal. Never say an order was placed or paid.

When the instructor asks to refund, cancel or get money back for a paid seat order, call propose_refund. It refunds nothing: it finds the most recent paid (COMPLETED) seat order and prepares a full refund for the instructor to confirm. After it succeeds, state the capture ID, class, seats and amount from the tool result and tell the instructor to click Confirm to issue the refund. If it reports no refundable order, say so. Never say a refund was issued.

Reply in plain text, under 60 words.`;

const TOOL_DEFINITIONS = [
  {
    name: 'get_seat_pricing',
    description: 'Returns the fixed price of one cohort seat, the currency, and the per-order seat limit.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_current_seats',
    description: "Returns the default class size, seats sold (unlocked) and pending (ordered, awaiting payment, holding no seat yet), seats remaining (class size less unlocked seats), and the signed-in instructor's own seat orders.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'create_seat_order',
    description: `Prepares a seat order proposal for the instructor to confirm. It does not create a PayPal order or charge anything. quantity is a whole number from 1 to ${MAX_SEATS_PER_ORDER}; class_name is a short label such as "Fall journeyman class".`,
    parameters: {
      type: 'object',
      properties: {
        quantity: { type: 'integer', description: `Number of seats, 1 to ${MAX_SEATS_PER_ORDER}.` },
        class_name: { type: 'string', description: 'Short class label, at most 80 characters.' },
      },
      required: ['quantity', 'class_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_refund',
    description: "Prepares a full refund of the signed-in instructor's most recent paid (COMPLETED) seat order, for the instructor to confirm. It issues no refund and moves no money.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];
// The same four tools as Anthropic tool definitions. None of them reaches PayPal: the only PayPal
// calls are behind the instructor's Confirm (confirmProposal below, and the refund endpoint).
const TOOLS = TOOL_DEFINITIONS.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters }));

export const isAgentConfigured = isAnthropicConfigured;

// Only text blocks become reply text. Thinking blocks (thinking, redacted_thinking) and tool_use
// blocks are never read into the reply.
export function replyText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
}

export function validateSeatRequest({ quantity, class_name: className }) {
  assertSeatQuantity(quantity);
  const normalizedName = tidyClassName(className);
  if (!normalizedName || normalizedName.length > 80) {
    throw Object.assign(new Error('Class name must be 1 to 80 characters.'), { statusCode: 400 });
  }
  return { quantity, className: normalizedName };
}

function publicProposal({ id, quantity, className, unitPrice, total, currency, expiresAt }) {
  return { id, quantity, className, unitPrice, total, currency, expiresAt: new Date(expiresAt).toISOString() };
}

// The instructor's most recent paid seat order that still holds its seats: the capture a refund
// would reverse. Rows come from listPaypalOrdersForUser, so they are the caller's own.
export function latestRefundableCapture(rows) {
  const className = canonicalClassNames(rows.map((row) => row.student_name));
  const candidates = rows
    .map((row) => ({ row, payment: Array.isArray(row.paypal_payments) ? row.paypal_payments[0] : row.paypal_payments }))
    .filter(({ row, payment }) => row.status === 'COMPLETED' && payment?.capture_id)
    .sort((a, b) => Date.parse(b.payment.created_at ?? b.row.created_at ?? 0) - Date.parse(a.payment.created_at ?? a.row.created_at ?? 0));
  const latest = candidates[0];
  if (!latest) return null;
  return {
    type: 'refund',
    captureId: latest.payment.capture_id,
    orderId: latest.row.paypal_order_id,
    className: className(latest.row.student_name),
    quantity: Number(latest.row.quantity ?? 1),
    amount: money(latest.row.amount),
    currency: latest.row.currency,
    capturedAt: latest.payment.created_at ?? null,
  };
}

export async function executeTool(name, input, { userId }) {
  if (name === 'get_seat_pricing') {
    return { result: { ...SEAT_PRICING, maxSeatsPerOrder: MAX_SEATS_PER_ORDER } };
  }
  if (name === 'get_current_seats') {
    const ledger = dashboardFromOrders(await listPaypalOrdersForUser(userId));
    const [quota] = ledger.quotas;
    return {
      result: {
        cohort: COHORT.name,
        defaultClassSize: quota.classSize,
        seatsSold: quota.seatsSold,
        seatsPending: quota.seatsReserved,
        seatsRemaining: quota.seatsRemaining,
        yourOrders: ledger.transactions.map(({ orderId, studentName, quantity, amount, currency, status }) => ({ orderId, name: studentName, quantity, amount, currency, status })),
      },
    };
  }
  if (name === 'create_seat_order') {
    const { quantity, className } = validateSeatRequest(input ?? {});
    const proposal = {
      id: randomUUID(),
      userId,
      quantity,
      className,
      unitPrice: SEAT_PRICING.unitPrice,
      total: seatOrderTotal(quantity),
      currency: SEAT_PRICING.currency,
      expiresAt: Date.now() + PROPOSAL_TTL_MS,
    };
    await saveSeatProposal(proposal);
    await logAgentAction({ userId, action: 'order_proposed', details: { proposalId: proposal.id, quantity, className, total: proposal.total } });
    return {
      result: { ...publicProposal(proposal), status: 'AWAITING_INSTRUCTOR_CONFIRMATION' },
      proposal: publicProposal(proposal),
    };
  }
  if (name === 'propose_refund') {
    const proposal = latestRefundableCapture(await listPaypalOrdersForUser(userId));
    if (!proposal) {
      await logAgentAction({ userId, action: 'refund_proposed', details: { captureId: null, reason: 'no refundable order' } });
      return { result: { refundable: false, reason: 'You have no paid seat order to refund.' } };
    }
    await logAgentAction({ userId, action: 'refund_proposed', details: { captureId: proposal.captureId, orderId: proposal.orderId, amount: proposal.amount } });
    return {
      result: { ...proposal, refundable: true, status: 'AWAITING_INSTRUCTOR_CONFIRMATION' },
      proposal,
    };
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { statusCode: 400 });
}

// The "AI trace" under each seat-assistant reply: what the server ran for each tool call. Only the
// tool name, the model's parsed arguments and a short server-made summary go in. The summary is
// built from fixed fields of the tool result, so the system prompt, thinking, keys, user IDs,
// emails and tokens never reach it.
export function traceResult(name, outcome) {
  const { result, proposal } = outcome;
  if (name === 'get_seat_pricing') {
    return { unitPrice: `${result.currency} ${result.unitPrice}`, maxSeatsPerOrder: result.maxSeatsPerOrder, priceFrom: 'server' };
  }
  if (name === 'get_current_seats') {
    return { classSize: result.defaultClassSize, seatsSold: result.seatsSold, seatsPending: result.seatsPending, seatsRemaining: result.seatsRemaining, yourOrders: result.yourOrders.length };
  }
  if (name === 'create_seat_order') {
    return {
      seats: proposal.quantity,
      class: proposal.className,
      unitPrice: `${proposal.currency} ${proposal.unitPrice}`,
      total: `${proposal.currency} ${proposal.total}`,
      priceFrom: 'server',
      status: 'Awaiting your Confirm. Nothing ordered or charged.',
    };
  }
  if (name === 'propose_refund') {
    if (!proposal) return { refundable: false, reason: result.reason };
    return {
      captureId: proposal.captureId,
      seats: proposal.quantity,
      amount: `${proposal.currency} ${proposal.amount}`,
      status: 'Awaiting your Confirm. Nothing refunded.',
    };
  }
  return {};
}

const traceArguments = (input) => (input && typeof input === 'object' && !Array.isArray(input) ? structuredClone(input) : null);

function validateMessages(messages) {
  const valid = Array.isArray(messages)
    && messages.length > 0
    && messages.length <= MAX_MESSAGES
    && messages.every(({ role, content }) => ['user', 'assistant'].includes(role)
      && typeof content === 'string'
      && content.trim().length > 0
      && content.length <= MAX_MESSAGE_LENGTH)
    && messages[0].role === 'user'
    && messages.at(-1).role === 'user';
  if (!valid) {
    throw Object.assign(new Error(`Send 1 to ${MAX_MESSAGES} text messages of at most ${MAX_MESSAGE_LENGTH} characters, ending with yours.`), { statusCode: 400 });
  }
  return messages.map(({ role, content }) => ({ role, content }));
}

// Server-side topic gate for turns where the model used no tools. On topic: the latest message
// mentions seats or orders, or is a short reply to an assistant turn that did.
export function isSeatRequest(messages) {
  const latest = messages.at(-1).content;
  if (SEAT_TOPIC.test(latest)) return true;
  const previous = messages.at(-2);
  return previous?.role === 'assistant'
    && SEAT_TOPIC.test(previous.content)
    && latest.trim().split(/\s+/).length <= MAX_FOLLOW_UP_WORDS;
}

// The Messages API delivers tool input as a parsed value; anything but a plain object is rejected.
function parseToolInput(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  throw Object.assign(new Error('Tool arguments must be a JSON object.'), { statusCode: 400 });
}

const timeoutError = () => Object.assign(new Error(TIMEOUT_REPLY), { statusCode: 504 });

// One Messages API call under a hard deadline. The AbortSignal covers the whole call, including
// a response that starts and then stalls; `timeout` is the SDK's own bound on the same call. A
// deadline that passes ends the request as a 504, never a hang.
async function createMessage(client, request, deadlineMs) {
  if (deadlineMs <= 0) throw timeoutError();
  // A plain timer, not AbortSignal.timeout(): that one does not keep the event loop alive.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    return await client.messages.create(request, { signal: controller.signal, timeout: deadlineMs });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'APIConnectionTimeoutError') throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// History arrives as text-only turns. Inside one request the loop appends each assistant message
// unchanged (thinking blocks included, as the Messages API requires on tool use) and answers every
// tool_use block in one user message of tool_result blocks. Model calls share one time budget per
// request, each capped on its own, so the whole request ends well inside a minute.
export async function runAgent({ userId, messages, client = anthropicClient('the seat assistant'), budgetMs = AGENT_REQUEST_BUDGET_MS, callTimeoutMs = MODEL_CALL_TIMEOUT_MS }) {
  const history = validateMessages(messages);
  const onTopic = isSeatRequest(history);
  const conversation = history.map(({ role, content }) => ({ role, content }));
  const deadline = Date.now() + budgetMs;
  await logAgentAction({ userId, action: 'chat_request', details: { message: history.at(-1).content.slice(0, 500) } });

  let proposal = null;
  let reply = '';
  let usedTools = false;
  const trace = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await createMessage(client, {
      model: studioAiModel(),
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: conversation,
      tools: TOOLS,
      tool_choice: { type: 'auto' },
      output_config: { effort: STUDIO_AI_EFFORT },
    }, Math.min(callTimeoutMs, deadline - Date.now()));

    if (!response || response.stop_reason === 'refusal') {
      reply = OFF_TOPIC_REPLY;
      break;
    }
    const content = Array.isArray(response.content) ? response.content : [];
    const toolUses = content.filter((block) => block?.type === 'tool_use');
    if (toolUses.length === 0) {
      reply = replyText(content);
      break;
    }

    usedTools = true;
    conversation.push({ role: 'assistant', content });
    const results = [];
    for (const toolUse of toolUses) {
      const { name } = toolUse;
      let input = toolUse.input;
      try {
        input = parseToolInput(toolUse.input);
        const outcome = await executeTool(name, input, { userId });
        if (outcome.proposal) proposal = outcome.proposal;
        trace.push({ tool: name, arguments: traceArguments(input), ok: true, result: traceResult(name, outcome) });
        await logAgentAction({ userId, action: 'tool_call', details: { tool: name, input } });
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(outcome.result) });
      } catch (error) {
        trace.push({ tool: name, arguments: traceArguments(input), ok: false, result: { error: error.message } });
        await logAgentAction({ userId, action: 'tool_rejected', details: { tool: name, input, reason: error.message } });
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }), is_error: true });
      }
    }
    conversation.push({ role: 'user', content: results });
  }

  if (!usedTools && !onTopic) {
    await logAgentAction({ userId, action: 'off_topic_blocked', details: { message: history.at(-1).content.slice(0, 500) } });
    return { reply: OFF_TOPIC_REPLY, proposal: null, trace };
  }

  reply ||= proposal?.type === 'refund'
    ? `Ready to refund ${proposal.currency} ${proposal.amount} for ${proposal.quantity} seats (${proposal.className}, capture ${proposal.captureId}). Click Confirm to issue the refund.`
    : proposal
      ? `Ready to order ${proposal.quantity} seats at ${proposal.currency} ${proposal.unitPrice} each, ${proposal.currency} ${proposal.total} total. Click Confirm to continue to PayPal.`
      : 'I could not finish that request. Please try again.';
  await logAgentAction({ userId, action: 'agent_reply', details: { proposalId: proposal?.id ?? proposal?.captureId ?? null } });
  return { reply, proposal, trace };
}

// Proposals live in Supabase (seat_proposals), so any server instance can confirm one. Claiming
// deletes it, so each proposal is confirmed at most once.
export async function confirmProposal({ proposalId, userId }) {
  const now = Date.now();
  const proposal = await claimSeatProposal({ proposalId, userId, now });
  if (!proposal) {
    const existing = await getSeatProposal(proposalId);
    if (existing && existing.userId !== userId && existing.expiresAt > now) {
      await logAgentAction({ userId, action: 'confirm_rejected', details: { proposalId, reason: 'different account' } });
      throw Object.assign(new Error('This seat proposal belongs to a different account.'), { statusCode: 403 });
    }
    throw Object.assign(new Error('This seat proposal expired or does not exist. Ask the assistant again.'), { statusCode: 404 });
  }

  try {
    const order = await createSandboxOrder({ studentName: proposal.className, userId, quantity: proposal.quantity });
    await logAgentAction({ userId, action: 'order_created', details: { proposalId, orderId: order.orderId, quantity: order.quantity, total: order.amount } });
    return order;
  } catch (error) {
    await logAgentAction({ userId, action: 'order_failed', details: { proposalId, reason: error.message } });
    throw error;
  }
}
