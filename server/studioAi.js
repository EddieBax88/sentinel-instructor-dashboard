import express, { Router } from 'express';
import { AGENT_MODEL, AGENT_TEMPLATE_KWARGS } from './config.js';
import { nvidiaClient, replyText } from './nvidia.js';
import { authenticateSupabaseUser, getBearerToken } from './supabase.js';

// Every tool AG Studio 3.0's agents can call: they read the report's data and schema and edit
// widgets, filters, pages, and plans in the browser. None places orders or moves money; seat
// purchases stay in the seat assistant with its Confirm step. Requests offering any other tool
// are refused, so this proxy cannot be used to drive other tools with the NVIDIA key.
export const STUDIO_TOOL_NAMES = new Set([
  'view_schema', 'view_report', 'view_page', 'view_plan', 'view_widget',
  'execute_query', 'create_expression', 'update_expression', 'delete_expression',
  'add_widget', 'configure_widget', 'position_widget', 'remove_widget',
  'add_widget_filter', 'remove_widget_filter', 'add_page_filter', 'remove_page_filter',
  'create_plan', 'update_plan', 'clear_plan', 'rename_thread',
  'delegate_to', 'complete_task',
]);

const SCOPE_NOTE = 'You are the analytics assistant in an instructor dashboard. You can only read the '
  + "instructor's seat-order data and build or change report widgets. You cannot buy seats, create orders, "
  + 'or take payments; if asked, say to use the Seat assistant on the Overview page, which asks for confirmation.';

const MAX_MESSAGES = 200;
const MAX_TOOLS = 30;
const MAX_OUTPUT_TOKENS = 16384;
// NVIDIA's free endpoint sometimes queues a turn for a long time before it starts. Turns are
// streamed; one with no chunk at all by this point is aborted and sent once more, and the second
// try runs to completion. Once chunks are flowing a turn is never aborted.
export const FIRST_CHUNK_TIMEOUT_MS = 10_000;
const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

// Client body (from src/analytics/nvidiaAdapter.js) -> NVIDIA request. The model, token cap, and
// sampling come from server config; anything else the client sends is ignored.
export function buildNvidiaRequest(body, { model = AGENT_MODEL, templateKwargs = AGENT_TEMPLATE_KWARGS } = {}) {
  const { messages, tools = [], tool_choice: toolChoice, response_format: responseFormat } = body ?? {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw fail(400, `Send 1 to ${MAX_MESSAGES} messages.`);
  }
  if (!messages.every((message) => message && ROLES.has(message.role))) throw fail(400, 'Unsupported message role.');
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw fail(400, `Send at most ${MAX_TOOLS} tools.`);
  const unknown = tools.map((tool) => tool?.function?.name).filter((name) => !STUDIO_TOOL_NAMES.has(name));
  if (unknown.length) throw fail(400, `Only AG Studio analytics tools are allowed (rejected: ${unknown.join(', ')}).`);
  const calledTools = messages.flatMap((message) => message.tool_calls ?? []).map((call) => call?.function?.name);
  if (calledTools.some((name) => !STUDIO_TOOL_NAMES.has(name))) throw fail(400, 'Conversation contains a tool call outside AG Studio.');

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

export function createStudioAiRouter({ client = () => nvidiaClient('the analytics assistant'), firstChunkTimeoutMs } = {}) {
  const router = Router();
  // Studio's tool definitions and history are larger than the app-wide JSON limit.
  router.use(express.json({ limit: '2mb' }));

  // POST /api/studio-ai/chat - sign-in only.
  router.post('/chat', async (request, response) => {
    try {
      await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
      const nvidiaRequest = buildNvidiaRequest(request.body);
      const { completion, latencyMs, ttftMs, retried, firstAttemptMs, retryMs } = await completeTurn(client(), nvidiaRequest, { firstChunkTimeoutMs });
      if (process.env.STUDIO_AI_TIMING === '1') {
        const row = { ...describeTurn(nvidiaRequest, completion, latencyMs), ttftMs, ...(retried && { retried, firstAttemptMs, retryMs }) };
        console.log(`[studio-ai] ${JSON.stringify(row)}`);
      }
      response.set('Cache-Control', 'no-store');
      response.json({ ...sanitizeCompletion(completion), elapsedMs: latencyMs });
    } catch (error) {
      const status = error.statusCode || (error.status >= 400 && error.status < 500 ? 502 : error.status) || 502;
      response.status(status).json({ error: error.statusCode ? error.message : `The analytics model request failed${error.status ? ` (${error.status})` : ''}.` });
    }
  });
  return router;
}

export default createStudioAiRouter();
