import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { AGENT_BASE_URL, AGENT_MODEL, MAX_SEATS_PER_ORDER } from './config.js';
import { assertSeatQuantity, createSandboxOrder, SEAT_PRICING, seatOrderTotal } from './paypal.js';
import { COHORT, getOrdersForUser, seatsRemaining } from './seatUnlock.js';
import { logAgentAction } from './supabase.js';

const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const MAX_TOOL_ROUNDS = 6;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;
export const OFF_TOPIC_REPLY = 'I can only help with seat pricing, seat availability, and buying cohort seats.';
const SEAT_TOPIC = /\b(seats?|orders?|ordering|buy|buying|purchas\w*|pric\w*|costs?|totals?|class(es)?|cohorts?|students?|enroll\w*|checkout|paypal|pay|payment|confirm\w*|cancel\w*|availab\w*|quantity|how many)\b/i;
const MAX_FOLLOW_UP_WORDS = 8;

const SYSTEM_PROMPT = `You are the seat-purchasing assistant on the Sentinel instructor dashboard. A signed-in instructor uses you to buy seats in their cohort through PayPal Sandbox.

You can do three things: report seat pricing, report seat availability and the instructor's own seat orders, and prepare a seat order for the instructor to confirm. If a request is about anything else, decline in one sentence and say what you can help with. Do not answer general questions, write other content, or discuss other products.

When the instructor asks to buy seats, call get_seat_pricing and get_current_seats, then call create_seat_order with the quantity and a short class name. If they did not give a quantity, ask for one; you may suggest the default class size from get_current_seats. Quantity must be a whole number from 1 to ${MAX_SEATS_PER_ORDER}.

create_seat_order does not charge anything or create a PayPal order. It prepares a proposal, and nothing is ordered until the instructor clicks Confirm on the dashboard. After it succeeds, state the quantity, unit price, and total from the tool result and tell the instructor to click Confirm to continue to PayPal. Never say an order was placed or paid.

Reply in plain text, under 60 words.`;

const TOOL_DEFINITIONS = [
  {
    name: 'get_seat_pricing',
    description: 'Returns the fixed price of one cohort seat, the currency, and the per-order seat limit.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_current_seats',
    description: "Returns the default class size, seats sold and pending, seats remaining to reach the default class size, and the signed-in instructor's own seat orders.",
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
];
const TOOLS = TOOL_DEFINITIONS.map((definition) => ({ type: 'function', function: definition }));

const proposals = new Map();
let defaultClient;

export function isAgentConfigured() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

function nvidiaClient() {
  if (!isAgentConfigured()) {
    throw Object.assign(new Error('Set NVIDIA_API_KEY in .env to enable the seat assistant.'), { statusCode: 503 });
  }
  defaultClient ??= new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: AGENT_BASE_URL });
  return defaultClient;
}

export function validateSeatRequest({ quantity, class_name: className }) {
  assertSeatQuantity(quantity);
  const normalizedName = typeof className === 'string' ? className.trim() : '';
  if (!normalizedName || normalizedName.length > 80) {
    throw Object.assign(new Error('Class name must be 1 to 80 characters.'), { statusCode: 400 });
  }
  return { quantity, className: normalizedName };
}

function publicProposal({ id, quantity, className, unitPrice, total, currency, expiresAt }) {
  return { id, quantity, className, unitPrice, total, currency, expiresAt: new Date(expiresAt).toISOString() };
}

export async function executeTool(name, input, { userId }) {
  if (name === 'get_seat_pricing') {
    return { result: { ...SEAT_PRICING, maxSeatsPerOrder: MAX_SEATS_PER_ORDER } };
  }
  if (name === 'get_current_seats') {
    return {
      result: {
        cohort: COHORT.name,
        defaultClassSize: COHORT.classSize,
        seatsRemaining: seatsRemaining(),
        yourOrders: getOrdersForUser(userId),
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
    proposals.set(proposal.id, proposal);
    await logAgentAction({ userId, action: 'order_proposed', details: { proposalId: proposal.id, quantity, className, total: proposal.total } });
    return {
      result: { ...publicProposal(proposal), status: 'AWAITING_INSTRUCTOR_CONFIRMATION' },
      proposal: publicProposal(proposal),
    };
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { statusCode: 400 });
}

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

function replyText(content) {
  return (content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function parseToolArguments(text) {
  try {
    const input = JSON.parse(text || '{}');
    if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  } catch {
    // fall through
  }
  throw Object.assign(new Error('Tool arguments must be a JSON object.'), { statusCode: 400 });
}

// History arrives as text-only turns; inside one request the loop appends each
// assistant message unchanged, as the model's chat template expects.
export async function runAgent({ userId, messages, client = nvidiaClient() }) {
  const history = validateMessages(messages);
  const onTopic = isSeatRequest(history);
  const conversation = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];
  await logAgentAction({ userId, action: 'chat_request', details: { message: history.at(-1).content.slice(0, 500) } });

  let proposal = null;
  let reply = '';
  let usedTools = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.chat.completions.create({
      model: AGENT_MODEL,
      messages: conversation,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 16384,
      temperature: 1,
      top_p: 0.95,
      // Required by NVIDIA's model card for this model to parse tool calls.
      chat_template_kwargs: { enable_thinking: true, force_nonempty_content: true },
    });

    const message = response.choices?.[0]?.message;
    if (!message || message.refusal) {
      reply = OFF_TOPIC_REPLY;
      break;
    }
    const toolCalls = (message.tool_calls ?? []).filter((call) => call.type === 'function');
    if (toolCalls.length === 0) {
      reply = replyText(message.content);
      break;
    }

    usedTools = true;
    conversation.push(message);
    for (const toolCall of toolCalls) {
      const { name } = toolCall.function;
      let input = toolCall.function.arguments;
      try {
        input = parseToolArguments(toolCall.function.arguments);
        const outcome = await executeTool(name, input, { userId });
        if (outcome.proposal) proposal = outcome.proposal;
        await logAgentAction({ userId, action: 'tool_call', details: { tool: name, input } });
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(outcome.result) });
      } catch (error) {
        await logAgentAction({ userId, action: 'tool_rejected', details: { tool: name, input, reason: error.message } });
        conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: error.message }) });
      }
    }
  }

  if (!usedTools && !onTopic) {
    await logAgentAction({ userId, action: 'off_topic_blocked', details: { message: history.at(-1).content.slice(0, 500) } });
    return { reply: OFF_TOPIC_REPLY, proposal: null };
  }

  reply ||= proposal
    ? `Ready to order ${proposal.quantity} seats at ${proposal.currency} ${proposal.unitPrice} each, ${proposal.currency} ${proposal.total} total. Click Confirm to continue to PayPal.`
    : 'I could not finish that request. Please try again.';
  await logAgentAction({ userId, action: 'agent_reply', details: { proposalId: proposal?.id ?? null } });
  return { reply, proposal };
}

export async function confirmProposal({ proposalId, userId }) {
  const proposal = proposals.get(proposalId);
  if (!proposal || proposal.expiresAt < Date.now()) {
    proposals.delete(proposalId);
    throw Object.assign(new Error('This seat proposal expired or does not exist. Ask the assistant again.'), { statusCode: 404 });
  }
  if (proposal.userId !== userId) {
    await logAgentAction({ userId, action: 'confirm_rejected', details: { proposalId, reason: 'different account' } });
    throw Object.assign(new Error('This seat proposal belongs to a different account.'), { statusCode: 403 });
  }

  proposals.delete(proposalId);
  try {
    const order = await createSandboxOrder({ studentName: proposal.className, userId, quantity: proposal.quantity });
    await logAgentAction({ userId, action: 'order_created', details: { proposalId, orderId: order.orderId, quantity: order.quantity, total: order.amount } });
    return order;
  } catch (error) {
    await logAgentAction({ userId, action: 'order_failed', details: { proposalId, reason: error.message } });
    throw error;
  }
}

export function resetAgentState() {
  proposals.clear();
}
