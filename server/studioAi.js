import express, { Router } from 'express';
import { AGENT_MODEL, AGENT_TEMPLATE_KWARGS, STUDIO_AI_EFFORT, studioAiModel } from './config.js';
import { anthropicClient } from './anthropic.js';
import { replyText } from './nvidia.js';
import { authenticateSupabaseUser, getBearerToken } from './supabase.js';

// Every tool AG Studio 3.0's agents can call: they read the report's data and schema and edit
// widgets, filters, pages, and plans in the browser. None places orders or moves money; seat
// requests go to the Seat agent (src/analytics/seatAgent.js), which runs in the browser against
// /api/agent/chat, and purchases still need the instructor's Confirm. Requests offering any other tool
// are refused, so this proxy cannot be used to drive other tools with the model key.
export const STUDIO_TOOL_NAMES = new Set([
  'view_schema', 'view_report', 'view_page', 'view_plan', 'view_widget',
  'execute_query', 'create_expression', 'update_expression', 'delete_expression',
  'add_widget', 'configure_widget', 'position_widget', 'remove_widget',
  'add_widget_filter', 'remove_widget_filter', 'add_page_filter', 'remove_page_filter',
  'create_plan', 'update_plan', 'clear_plan', 'rename_thread',
  'delegate_to', 'complete_task',
]);

const SCOPE_NOTE = 'You are the analytics assistant in an instructor dashboard. You read the '
  + "instructor's seat-order data and build or change report widgets. You cannot buy seats, create orders, "
  + 'or take payments yourself. For buying, ordering or pricing seats, hand off to the Seat agent '
  + '(delegate_to type "seat"); it prepares a proposal that the instructor must confirm on the dashboard. '
  + 'Never say seats were ordered or paid for.';

const MAX_MESSAGES = 200;
const MAX_TOOLS = 30;
const MAX_OUTPUT_TOKENS = 16384;
// A model turn can sit queued for a long time before it starts. Turns are streamed; one with no
// content at all by this point is aborted and sent once more, and the second try runs to
// completion. Once content is flowing a turn is never aborted.
export const FIRST_CHUNK_TIMEOUT_MS = 10_000;
const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

// Checks the client body (from src/analytics/nvidiaAdapter.js): message count and roles, and
// that every offered or replayed tool is an AG Studio tool.
function validateStudioBody(body) {
  const { messages, tools = [] } = body ?? {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw fail(400, `Send 1 to ${MAX_MESSAGES} messages.`);
  }
  if (!messages.every((message) => message && ROLES.has(message.role))) throw fail(400, 'Unsupported message role.');
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw fail(400, `Send at most ${MAX_TOOLS} tools.`);
  const unknown = tools.map((tool) => tool?.function?.name).filter((name) => !STUDIO_TOOL_NAMES.has(name));
  if (unknown.length) throw fail(400, `Only AG Studio analytics tools are allowed (rejected: ${unknown.join(', ')}).`);
  const calledTools = messages.flatMap((message) => message.tool_calls ?? []).map((call) => call?.function?.name);
  if (calledTools.some((name) => !STUDIO_TOOL_NAMES.has(name))) throw fail(400, 'Conversation contains a tool call outside AG Studio.');
}

// Client body -> NVIDIA request (kept as the probe's baseline). The model, token cap, and
// sampling come from server config; anything else the client sends is ignored.
export function buildNvidiaRequest(body, { model = AGENT_MODEL, templateKwargs = AGENT_TEMPLATE_KWARGS } = {}) {
  validateStudioBody(body);
  const { messages, tools = [], tool_choice: toolChoice, response_format: responseFormat } = body;
  return {
    model,
    messages: [{ role: 'system', content: SCOPE_NOTE }, ...messages],
    ...(tools.length && { tools: tools.map((tool) => ({ type: 'function', function: tool.function })) }),
    ...(toolChoice && { tool_choice: toolChoice }),
    ...(responseFormat && { response_format: responseFormat }),
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 1,
    top_p: 0.95,
    chat_template_kwargs: templateKwargs,
  };
}

// NVIDIA response -> what the browser gets: cleaned text and Studio tool calls only. Reasoning
// fields (reasoning_content, reasoning) and <think> text are dropped.
export function sanitizeCompletion(completion) {
  const choice = completion?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const toolCalls = (message.tool_calls ?? [])
    .filter((call) => call?.type === 'function' && STUDIO_TOOL_NAMES.has(call.function?.name))
    .map((call) => ({ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments ?? '{}' } }));
  return {
    id: completion?.id,
    model: completion?.model,
    finish_reason: choice.finish_reason,
    message: { role: 'assistant', content: replyText(message.content), ...(toolCalls.length && { tool_calls: toolCalls }) },
    ...(completion?.usage && { usage: completion.usage }),
  };
}

// Which AG Studio agent sent a turn, from the opening of its instructions (AG Studio 3.0).
const AGENT_SIGNATURES = [
  ['lead', /You are the Orchestrator/i],
  ['data', /You are a data analyst/i],
  ['widget', /You configure a single/i],
  ['page', /You are the page manager/i],
  ['planning', /planning specialist/i],
];

const estimateTokens = (text) => Math.round(text.length / 4);

// One timing row per model turn, for `STUDIO_AI_TIMING=1` and scripts/time-ask-ai.mjs. Thinking
// tokens come from NVIDIA's usage details when reported, otherwise they are estimated from the
// reasoning text (about 4 characters per token) and marked estimated. Nothing here is returned
// to the browser.
export function describeTurn(nvidiaRequest, completion, latencyMs) {
  const instructions = nvidiaRequest.messages.find((message, index) => index > 0 && message.role === 'system')?.content ?? '';
  const agent = AGENT_SIGNATURES.find(([, pattern]) => pattern.test(instructions))?.[0] ?? 'unknown';
  const choice = completion?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content = typeof message.content === 'string' ? message.content : '';
  const closing = content.toLowerCase().lastIndexOf('</think>');
  const reasoning = [message.reasoning_content, message.reasoning, closing === -1 ? '' : content.slice(0, closing)]
    .filter((part) => typeof part === 'string' && part).join('');
  const reported = completion?.usage?.completion_tokens_details?.reasoning_tokens;
  return {
    agent,
    latencyMs,
    inputTokens: completion?.usage?.prompt_tokens ?? null,
    outputTokens: completion?.usage?.completion_tokens ?? null,
    thinkingTokens: typeof reported === 'number' ? reported : estimateTokens(reasoning),
    thinkingEstimated: typeof reported !== 'number',
    tools: (message.tool_calls ?? []).map((call) => call?.function?.name).filter(Boolean),
    finishReason: choice.finish_reason ?? null,
    toolResults: latestToolResults(nvidiaRequest.messages),
  };
}

const RESULT_PREVIEW_CHARS = 400;

// The results of the latest tool round this turn was sent with (after the last assistant message;
// on an agent's first turn, its last preloaded call): which tool, whether it succeeded, and its
// errors and health issues, so a repeated call can be traced to what the model was told.
export function latestToolResults(messages) {
  const lastAssistant = messages.findLastIndex((message) => message.role === 'assistant');
  const names = new Map(messages.flatMap((message) => message.tool_calls ?? []).map((call) => [call.id, call.function?.name]));
  return messages.slice(lastAssistant + 1).filter((message) => message.role === 'tool').map((message) => {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const issues = (parsed?.issues ?? parsed?.data?.issues ?? []).map((issue) => issue.message ?? `${issue.code}: ${issue.description} (score ${issue.score})`);
    return {
      tool: names.get(message.tool_call_id) ?? 'unknown',
      success: typeof parsed?.success === 'boolean' ? parsed.success : null,
      ...(issues.length && { issues: issues.map((issue) => String(issue).slice(0, 200)) }),
      preview: text.slice(0, RESULT_PREVIEW_CHARS),
    };
  });
}

// Streamed chunks -> the non-streamed completion shape the rest of the proxy reads.
async function collectStream(stream, onFirstChunk) {
  const message = { role: 'assistant', content: '', reasoning_content: '' };
  const toolCalls = [];
  let first = true;
  let id;
  let model;
  let finishReason = null;
  let usage;
  for await (const chunk of stream) {
    if (first) {
      first = false;
      onFirstChunk();
    }
    id ??= chunk.id;
    model ??= chunk.model;
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string') message.content += delta.content;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string') message.reasoning_content += reasoning;
      for (const part of delta.tool_calls ?? []) {
        const call = (toolCalls[part.index ?? toolCalls.length] ??= { id: undefined, type: 'function', function: { name: '', arguments: '' } });
        if (part.id) call.id = part.id;
        if (part.type) call.type = part.type;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  const calls = toolCalls.filter(Boolean);
  return {
    id,
    model,
    choices: [{ index: 0, message: { ...message, ...(calls.length && { tool_calls: calls }) }, finish_reason: finishReason }],
    ...(usage && { usage }),
  };
}

// One streamed attempt. With a deadline, it is aborted if no chunk has arrived by then.
async function streamTurn(client, nvidiaRequest, deadlineMs) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = deadlineMs === undefined ? null : setTimeout(() => controller.abort(), deadlineMs);
  let ttftMs = null;
  try {
    const stream = await client.chat.completions.create(
      { ...nvidiaRequest, stream: true, stream_options: { include_usage: true } },
      { signal: controller.signal },
    );
    const completion = await collectStream(stream, () => {
      ttftMs = Date.now() - started;
      clearTimeout(timer);
    });
    return { completion, ms: Date.now() - started, ttftMs, stalled: false };
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    return { ms: Date.now() - started, ttftMs: null, stalled: true };
  } finally {
    clearTimeout(timer);
  }
}

// One model turn, retried once if nothing at all arrives within the first-chunk timeout. Errors
// other than that abort are thrown as before; the retry has no deadline, so a slow endpoint never
// fails the question.
export async function completeTurn(client, nvidiaRequest, { firstChunkTimeoutMs = FIRST_CHUNK_TIMEOUT_MS } = {}) {
  const first = await streamTurn(client, nvidiaRequest, firstChunkTimeoutMs);
  if (!first.stalled) return { completion: first.completion, latencyMs: first.ms, ttftMs: first.ttftMs, retried: false };
  const retry = await streamTurn(client, nvidiaRequest);
  return {
    completion: retry.completion,
    latencyMs: first.ms + retry.ms,
    ttftMs: retry.ttftMs,
    retried: true,
    firstAttemptMs: first.ms,
    retryMs: retry.ms,
  };
}

// ---- Ask AI on Anthropic Claude (Messages API) ----
// The browser adapter keeps sending OpenAI Chat Completions-shaped bodies and reading the same
// reply shape; these functions translate both ways.

// Anthropic tool_use ids allow only letters, digits, `_` and `-`. Studio's own call ids already
// fit; anything else is mapped the same way in tool_use and tool_result so they still pair up.
const toolUseId = (id) => String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'call';

const parseArguments = (text) => {
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

const textContent = (content) => (typeof content === 'string' ? content : '');

// Forced tool choices return 400 on current Claude models, so they become `auto`.
function toAnthropicToolChoice(choice) {
  if (!choice) return undefined;
  if (choice === 'none') return { type: 'none' };
  return { type: 'auto' };
}

// Client body -> Messages API request. System messages become the top-level `system`; assistant
// tool calls become tool_use blocks; all tool results of one round go in a single user message.
// The client's model, sampling, and template settings are ignored; thinking stays on (model
// default) and `effort` sets its depth. Tools are sent as Studio defines them, without
// `strict: true`: most of Studio's schemas fail Anthropic's strict rules (see
// `npm run check:strict-tools`).
export function buildAnthropicRequest(body, { model = studioAiModel(), effort = STUDIO_AI_EFFORT } = {}) {
  validateStudioBody(body);
  const { messages, tools = [], tool_choice: toolChoice, response_format: responseFormat } = body;

  const system = [{ type: 'text', text: SCOPE_NOTE }];
  const turns = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = turns.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  };
  for (const message of messages) {
    const text = textContent(message.content).trim();
    if (message.role === 'system') {
      if (text) system.push({ type: 'text', text });
    } else if (message.role === 'user') {
      push('user', text ? [{ type: 'text', text }] : []);
    } else if (message.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: toolUseId(message.tool_call_id), content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '') }]);
    } else {
      const calls = (message.tool_calls ?? []).map((call) => ({ type: 'tool_use', id: toolUseId(call.id), name: call.function?.name, input: parseArguments(call.function?.arguments) }));
      push('assistant', [...(text ? [{ type: 'text', text }] : []), ...calls]);
    }
  }
  // Tool results must open their user message; text from the same round goes after them.
  for (const turn of turns) {
    if (turn.role === 'user') turn.content.sort((a, b) => (a.type === 'tool_result' ? 0 : 1) - (b.type === 'tool_result' ? 0 : 1));
  }

  const choice = toAnthropicToolChoice(toolChoice);
  const schema = responseFormat?.type === 'json_schema' ? responseFormat.json_schema?.schema : undefined;
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: turns,
    ...(tools.length && {
      tools: tools.map(({ function: fn }) => ({
        name: fn.name,
        ...(fn.description && { description: fn.description }),
        input_schema: fn.parameters ?? { type: 'object', properties: {} },
      })),
    }),
    ...(tools.length && choice && { tool_choice: choice }),
    output_config: { effort, ...(schema && { format: { type: 'json_schema', schema } }) },
  };
}

const FINISH_REASONS = { tool_use: 'tool_calls', max_tokens: 'length' };

// A refusal goes back to the browser as a clean error; there is no fallback model.
export const REFUSAL_MESSAGE = 'The analytics assistant declined this request. Try asking about your seat-order data or report widgets.';

// Messages API response -> the reply shape the browser adapter decodes. Thinking blocks are
// dropped; only AG Studio tool calls pass through.
const studioToolCalls = (message) => (message?.content ?? [])
  .filter((block) => block.type === 'tool_use' && STUDIO_TOOL_NAMES.has(block.name))
  .map((block) => ({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }));

// Messages usage -> Chat Completions usage; input counts cache reads and writes too.
function chatUsage(usage) {
  if (!usage) return undefined;
  const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const output = usage.output_tokens ?? 0;
  return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output };
}

export function toStudioReply(message) {
  if (message?.stop_reason === 'refusal') throw fail(422, REFUSAL_MESSAGE);
  const text = (message?.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
  const toolCalls = studioToolCalls(message);
  const usage = chatUsage(message?.usage);
  return {
    id: message?.id,
    model: message?.model,
    finish_reason: FINISH_REASONS[message?.stop_reason] ?? 'stop',
    message: { role: 'assistant', content: text, ...(toolCalls.length && { tool_calls: toolCalls }) },
    ...(usage && { usage }),
  };
}

// One streamed Messages attempt. With a deadline, it is aborted if no content event has arrived
// by then (message_start arrives at once, so it does not count).
async function streamMessage(client, request, deadlineMs) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = deadlineMs === undefined ? null : setTimeout(() => controller.abort(), deadlineMs);
  let ttftMs = null;
  try {
    const stream = client.messages.stream(request, { signal: controller.signal });
    for await (const event of stream) {
      if (ttftMs === null && (event.type === 'content_block_start' || event.type === 'content_block_delta')) {
        ttftMs = Date.now() - started;
        clearTimeout(timer);
      }
    }
    const message = await stream.finalMessage();
    return { message, ms: Date.now() - started, ttftMs, stalled: false };
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    return { ms: Date.now() - started, ttftMs: null, stalled: true };
  } finally {
    clearTimeout(timer);
  }
}

// One Claude turn, retried once if no content arrives within the first-token timeout. Other
// errors are thrown; the retry has no deadline.
export async function completeAnthropicTurn(client, request, { firstChunkTimeoutMs = FIRST_CHUNK_TIMEOUT_MS } = {}) {
  const first = await streamMessage(client, request, firstChunkTimeoutMs);
  if (!first.stalled) return { message: first.message, latencyMs: first.ms, ttftMs: first.ttftMs, retried: false };
  const retry = await streamMessage(client, request);
  return {
    message: retry.message,
    latencyMs: first.ms + retry.ms,
    ttftMs: retry.ttftMs,
    retried: true,
    firstAttemptMs: first.ms,
    retryMs: retry.ms,
  };
}

// One timing row per Claude turn, for `STUDIO_AI_TIMING=1`. Tokens come from Messages usage
// (input includes cache reads and writes). Thinking text is not returned, so it is not counted.
export function describeAnthropicTurn(body, request, message, latencyMs) {
  const instructions = request.system.slice(1).map((block) => block.text).join('\n');
  const agent = AGENT_SIGNATURES.find(([, pattern]) => pattern.test(instructions))?.[0] ?? 'unknown';
  const usage = chatUsage(message?.usage);
  return {
    agent,
    model: request.model,
    effort: request.output_config?.effort ?? null,
    latencyMs,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    tools: studioToolCalls(message).map((call) => call.function.name),
    finishReason: message?.stop_reason ?? null,
    toolResults: latestToolResults(body.messages),
  };
}

export function createStudioAiRouter({ client = () => anthropicClient('the analytics assistant'), model, effort, firstChunkTimeoutMs } = {}) {
  const router = Router();
  // Studio's tool definitions and history are larger than the app-wide JSON limit.
  router.use(express.json({ limit: '2mb' }));

  // POST /api/studio-ai/chat - sign-in only.
  router.post('/chat', async (request, response) => {
    try {
      await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
      const claudeRequest = buildAnthropicRequest(request.body, { model: model ?? studioAiModel(), effort: effort ?? STUDIO_AI_EFFORT });
      const { message, latencyMs, ttftMs, retried, firstAttemptMs, retryMs } = await completeAnthropicTurn(client(), claudeRequest, { firstChunkTimeoutMs });
      if (process.env.STUDIO_AI_TIMING === '1') {
        const row = { ...describeAnthropicTurn(request.body, claudeRequest, message, latencyMs), ttftMs, ...(retried && { retried, firstAttemptMs, retryMs }) };
        console.log(`[studio-ai] ${JSON.stringify(row)}`);
      }
      const reply = toStudioReply(message);
      response.set('Cache-Control', 'no-store');
      response.json({ ...reply, elapsedMs: latencyMs });
    } catch (error) {
      const status = error.statusCode || (error.status >= 400 && error.status < 500 ? 502 : error.status) || 502;
      response.status(status).json({ error: error.statusCode ? error.message : `The analytics model request failed${error.status ? ` (${error.status})` : ''}.` });
    }
  });
  return router;
}

export default createStudioAiRouter();
