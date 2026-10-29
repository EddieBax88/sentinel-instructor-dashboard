import express, { Router } from 'express';
import { STUDIO_AGENT_MODEL, STUDIO_AGENT_TEMPLATE_KWARGS } from './config.js';
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
const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

// Client body (from src/analytics/nvidiaAdapter.js) -> NVIDIA request. The model, token cap, and
// sampling come from server config; anything else the client sends is ignored.
export function buildNvidiaRequest(body, { model = STUDIO_AGENT_MODEL, templateKwargs = STUDIO_AGENT_TEMPLATE_KWARGS } = {}) {
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

export function createStudioAiRouter({ client = () => nvidiaClient('the analytics assistant') } = {}) {
  const router = Router();
  // Studio's tool definitions and history are larger than the app-wide JSON limit.
  router.use(express.json({ limit: '2mb' }));

  // POST /api/studio-ai/chat - sign-in only.
  router.post('/chat', async (request, response) => {
    try {
      await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
      const nvidiaRequest = buildNvidiaRequest(request.body);
      const started = Date.now();
      const completion = await client().chat.completions.create(nvidiaRequest);
      response.set('Cache-Control', 'no-store');
      response.json({ ...sanitizeCompletion(completion), elapsedMs: Date.now() - started });
    } catch (error) {
      const status = error.statusCode || (error.status >= 400 && error.status < 500 ? 502 : error.status) || 502;
      response.status(status).json({ error: error.statusCode ? error.message : `The analytics model request failed${error.status ? ` (${error.status})` : ''}.` });
    }
  });
  return router;
}

export default createStudioAiRouter();
