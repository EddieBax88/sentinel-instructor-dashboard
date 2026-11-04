import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { encodeRequest } from '../src/analytics/nvidiaAdapter.js';
import { AGENT_MODEL, AGENT_TEMPLATE_KWARGS } from './config.js';
import { STUDIO_AI_DEFAULT_MODEL, STUDIO_AI_EFFORT } from './config.js';
import {
  buildAnthropicRequest, buildNvidiaRequest, completeAnthropicTurn, completeTurn, createStudioAiRouter, describeAnthropicTurn,
  describeTurn, latestToolResults, REFUSAL_MESSAGE, sanitizeCompletion, STUDIO_TOOL_NAMES, TIMEOUT_MESSAGE, toStudioReply,
} from './studioAi.js';

const FAKE_KEY = 'sk-ant-test-key-that-must-never-reach-the-browser';
const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const fixtures = JSON.parse(readFileSync(new URL('../scripts/fixtures/studio-agent-requests.json', import.meta.url), 'utf8'));
const originalFetch = globalThis.fetch;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NVIDIA_API_KEY', 'ANTHROPIC_API_KEY', 'STUDIO_AI_MODEL'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

let modelCalls;
let modelReply;

// NVIDIA Chat Completions stand-in (the probe's baseline path).
const fakeClient = () => ({
  chat: {
    completions: {
      create: async (body) => {
        const { stream, stream_options: streamOptions, ...request } = body;
        modelCalls.push(structuredClone(request));
        const reply = await modelReply(request);
        return stream ? streamOf(reply) : reply;
      },
    },
  },
});

// Supabase Auth stand-in: only 'valid-token' is a signed-in instructor.
async function fakeFetch(url, options = {}) {
  const { hostname, pathname } = new URL(url);
  if (hostname === '127.0.0.1') return originalFetch(url, options);
  if (hostname === 'example.supabase.co' && pathname === '/auth/v1/user') {
    return options.headers.Authorization === 'Bearer valid-token'
      ? Response.json({ id: INSTRUCTOR })
      : Response.json({ message: 'invalid' }, { status: 401 });
  }
  throw new Error(`Unexpected request to ${url}`);
}

// A completion as the chunks NVIDIA streams: role, reasoning, content, tool-call pieces, finish,
// then usage. `firstDelayMs` holds back the first chunk; `gapMs` spaces the rest.
async function* streamOf(reply, { firstDelayMs = 0, gapMs = 0, signal } = {}) {
  const wait = (ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Request was aborted.'), { name: 'AbortError' }));
    });
  });
  const choice = reply.choices[0];
  const message = choice.message;
  const base = { id: reply.id, model: reply.model };
  const deltas = [{ role: 'assistant' }];
  if (message.reasoning_content) deltas.push({ reasoning_content: message.reasoning_content });
  if (message.reasoning) deltas.push({ reasoning: message.reasoning });
  if (message.content) deltas.push({ content: message.content.slice(0, 3) }, { content: message.content.slice(3) });
  (message.tool_calls ?? []).forEach((call, index) => {
    const args = call.function.arguments ?? '';
    deltas.push(
      { tool_calls: [{ index, id: call.id, type: call.type, function: { name: call.function.name, arguments: args.slice(0, 2) } }] },
      { tool_calls: [{ index, function: { arguments: args.slice(2) } }] },
    );
  });
  await wait(firstDelayMs);
  for (const [i, delta] of deltas.entries()) {
    if (i) await wait(gapMs);
    yield { ...base, choices: [{ index: 0, delta, finish_reason: null }] };
  }
  yield { ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] };
  if (reply.usage) yield { ...base, choices: [], usage: reply.usage };
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('Request was aborted.'), { name: 'AbortError' }));
  });
});

// A Messages API response as the Anthropic SDK's MessageStream delivers it: message_start at
// once, then content events (held back by `firstMs`, spaced by `gapMs`), then finalMessage().
function messageStreamOf(message, { firstMs = 0, gapMs = 0, signal } = {}) {
  const events = async function* events() {
    yield { type: 'message_start', message: { ...message, content: [], stop_reason: null } };
    await wait(firstMs, signal);
    for (const [index, block] of message.content.entries()) {
      if (index) await wait(gapMs, signal);
      yield { type: 'content_block_start', index, content_block: block };
      yield { type: 'content_block_stop', index };
    }
    yield { type: 'message_delta', delta: { stop_reason: message.stop_reason } };
    yield { type: 'message_stop' };
  };
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  return {
    async* [Symbol.asyncIterator]() {
      yield* events();
      done();
    },
    finalMessage: async () => {
      await finished;
      return message;
    },
  };
}

const claudeMessage = (content, stopReason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: STUDIO_AI_DEFAULT_MODEL, content, stop_reason: stopReason,
  usage: { input_tokens: 90, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 20 },
});

// Anthropic client stand-in for the app's proxy. Each call records the request; `claudeReply`
// returns the message (or throws). `script` steps: 'stall' sends no content until aborted,
// { firstMs, gapMs } streams with those delays, an Error is thrown.
let claudeCalls;
let claudeReply;
function fakeAnthropic(script = []) {
  const calls = [];
  return {
    calls,
    messages: {
      stream: (body, options = {}) => {
        const step = script[calls.length];
        calls.push({ body, signal: options.signal, timeout: options.timeout });
        claudeCalls.push(structuredClone(body));
        if (step instanceof Error) throw step;
        const message = claudeReply(body, calls.length);
        if (step === 'stall') return messageStreamOf(message, { firstMs: 1e9, signal: options.signal });
        return messageStreamOf(message, { firstMs: step?.firstMs ?? 0, gapMs: step?.gapMs ?? 0, signal: options.signal });
      },
    },
  };
}

async function post(body, { token = 'valid-token', client = () => fakeAnthropic(), firstChunkTimeoutMs, turnTimeoutMs } = {}) {
  const app = express();
  app.use('/api/studio-ai', createStudioAiRouter({ client, firstChunkTimeoutMs, turnTimeoutMs }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/studio-ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, headers: [...response.headers].join('\n'), body: JSON.parse(text) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const completion = (message, finishReason = 'stop') => ({
  id: 'cmpl-1', model: AGENT_MODEL, choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
});

const leadBody = () => encodeRequest(fixtures.lead);

test.beforeEach(() => {
  modelCalls = [];
  modelReply = () => completion({ content: 'Done.' });
  claudeCalls = [];
  claudeReply = () => claudeMessage([{ type: 'text', text: 'Done.' }]);
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  delete process.env.STUDIO_AI_MODEL;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NVIDIA_API_KEY = FAKE_KEY;
  globalThis.fetch = fakeFetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('requires sign-in: no token or an invalid token gets 401 and never reaches the model', async () => {
  const missing = await post(leadBody(), { token: null });
  assert.equal(missing.status, 401);
  const invalid = await post(leadBody(), { token: 'forged' });
  assert.equal(invalid.status, 401);
  assert.equal(claudeCalls.length, 0);
});

test("the server picks the Claude model and settings; the client's model, token cap, sampling, and key fields are ignored", async () => {
  const { status } = await post({ ...leadBody(), model: 'some/other-model', max_tokens: 999999, api_key: 'client-key', chat_template_kwargs: { x: 1 }, temperature: 0.2, top_p: 0.5 });

  assert.equal(status, 200);
  const [sent] = claudeCalls;
  assert.equal(sent.model, STUDIO_AI_DEFAULT_MODEL);
  assert.equal(sent.max_tokens, 16384);
  assert.deepEqual(sent.output_config, { effort: STUDIO_AI_EFFORT });
  for (const key of ['api_key', 'chat_template_kwargs', 'temperature', 'top_p', 'thinking', 'stream', 'fallbacks']) assert.equal(sent[key], undefined, key);
  assert.match(sent.system[0].text, /cannot buy seats, create orders, or take payments/);
  assert.equal(sent.system[1].text, fixtures.lead.instructions);
  assert.ok(sent.messages.every((message) => message.role !== 'system'));
  assert.deepEqual(sent.tools.map((tool) => tool.name), fixtures.lead.tools.map((tool) => tool.name));
});

test('STUDIO_AI_MODEL picks the Claude model without a code change', async () => {
  process.env.STUDIO_AI_MODEL = 'claude-haiku-5-5';
  await post(leadBody());
  assert.equal(claudeCalls[0].model, 'claude-haiku-5-5');
});

test('the Anthropic key never appears in a response, including error responses', async () => {
  claudeReply = () => claudeMessage([{ type: 'text', text: 'Here is your chart.' }]);
  const ok = await post(leadBody());
  assert.equal(ok.status, 200);

  claudeReply = () => { throw Object.assign(new Error(`401 invalid x-api-key ${FAKE_KEY}`), { status: 401 }); };
  const failed = await post(leadBody());
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /analytics model request failed/);

  for (const response of [ok, failed]) {
    assert.ok(!response.text.includes(FAKE_KEY));
    assert.ok(!response.headers.includes(FAKE_KEY));
  }
});

test('without ANTHROPIC_API_KEY the proxy answers 503 with a setup message', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const app = express();
  app.use('/api/studio-ai', createStudioAiRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/studio-ai/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' }, body: JSON.stringify(leadBody()),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Set ANTHROPIC_API_KEY/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('thinking blocks are dropped; only text reaches the browser', async () => {
  claudeReply = () => claudeMessage([
    { type: 'thinking', thinking: 'SECRET chain of thought', signature: 'sig' },
    { type: 'redacted_thinking', data: 'SECRET too' },
    { type: 'text', text: 'Revenue by class is ready.' },
  ]);
  const { body, text } = await post(leadBody());
  assert.equal(body.message.content, 'Revenue by class is ready.');
  assert.equal(body.message.tool_calls, undefined);
  assert.ok(!text.includes('SECRET'));
});

test('tool_use blocks become Studio tool calls; any tool the model invents is dropped', async () => {
  claudeReply = () => claudeMessage([
    { type: 'text', text: 'Checking.' },
    { type: 'tool_use', id: 'toolu_1', name: 'view_schema', input: {} },
    { type: 'tool_use', id: 'toolu_2', name: 'create_seat_order', input: { quantity: 5 } },
    { type: 'tool_use', id: 'toolu_3', name: 'rename_thread', input: { title: 'Revenue' } },
  ], 'tool_use');
  const { body } = await post(leadBody());
  assert.equal(body.finish_reason, 'tool_calls');
  assert.equal(body.message.content, 'Checking.');
  assert.deepEqual(body.message.tool_calls, [
    { id: 'toolu_1', type: 'function', function: { name: 'view_schema', arguments: '{}' } },
    { id: 'toolu_3', type: 'function', function: { name: 'rename_thread', arguments: '{"title":"Revenue"}' } },
  ]);
  assert.deepEqual(body.usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
});

test('a turn with no tool call comes back as a plain text message', async () => {
  claudeReply = () => claudeMessage([{ type: 'text', text: 'Your top class is Fall A.' }], 'end_turn');
  const { status, body } = await post(leadBody());
  assert.equal(status, 200);
  assert.deepEqual(body.message, { role: 'assistant', content: 'Your top class is Fall A.' });
  assert.equal(body.finish_reason, 'stop');
});

test('a refusal is returned as a clean error, with no fallback model', async () => {
  claudeReply = () => ({ ...claudeMessage([{ type: 'text', text: 'partial' }], 'refusal'), stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } });
  const { status, body } = await post(leadBody());
  assert.equal(status, 422);
  assert.equal(body.error, REFUSAL_MESSAGE);
  assert.equal(claudeCalls.length, 1);
  assert.equal(claudeCalls[0].fallbacks, undefined);
});

test('refuses requests that offer or replay tools outside AG Studio, such as seat ordering', async () => {
  const withSeatTool = leadBody();
  withSeatTool.tools.push({ type: 'function', function: { name: 'create_seat_order', description: 'Buy seats', parameters: { type: 'object' } } });
  const offered = await post(withSeatTool);
  assert.equal(offered.status, 400);
  assert.match(offered.body.error, /Only AG Studio analytics tools/);

  const replayed = leadBody();
  replayed.messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'confirm_order', arguments: '{}' } }] });
  const history = await post(replayed);
  assert.equal(history.status, 400);

  const badRole = await post({ messages: [{ role: 'developer', content: 'hi' }] });
  assert.equal(badRole.status, 400);
  assert.equal(claudeCalls.length, 0);
});

test("accepts Studio's largest real request (widget agent, ~56 KB)", async () => {
  const body = encodeRequest(fixtures.widget);
  assert.ok(JSON.stringify(body).length > 50_000);
  const { status } = await post(body);
  assert.equal(status, 200);
  assert.equal(claudeCalls[0].tools.length, fixtures.widget.tools.length);
});

test('every tool in the captured Studio requests is on the allowlist', () => {
  for (const request of Object.values(fixtures)) {
    for (const tool of request.tools) assert.ok(STUDIO_TOOL_NAMES.has(tool.name), tool.name);
  }
});

test('sanitizeCompletion keeps only the cleaned message, finish reason, and usage', () => {
  const clean = sanitizeCompletion(completion({ content: '<think>plan</think>Answer', reasoning_content: 'hidden' }, 'length'));
  assert.deepEqual(clean, {
    id: 'cmpl-1', model: AGENT_MODEL, finish_reason: 'length',
    message: { role: 'assistant', content: 'Answer' },
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  });
});

test('describeTurn names the Studio agent and reports latency, tokens, and tools called', () => {
  const widget = buildNvidiaRequest(encodeRequest(fixtures.widget));
  const reported = describeTurn(widget, {
    choices: [{ message: { content: 'Done.', reasoning_content: 'x'.repeat(400), tool_calls: [{ type: 'function', function: { name: 'configure_widget', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 9000, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 250 } },
  }, 4200);
  assert.deepEqual(reported, {
    agent: 'widget', latencyMs: 4200, inputTokens: 9000, outputTokens: 300, thinkingTokens: 250, thinkingEstimated: false, tools: ['configure_widget'], finishReason: 'tool_calls',
    toolResults: [{ tool: 'view_plan', success: true, preview: '{"success":true,"response":"No plan.","data":{"plan":null}}' }],
  });

  const agents = Object.entries(fixtures).map(([name, request]) => [name, describeTurn(buildNvidiaRequest(encodeRequest(request)), {}, 0).agent]);
  assert.deepEqual(agents, Object.keys(fixtures).map((name) => [name, name]));

  const estimated = describeTurn(widget, { choices: [{ message: { content: `${'y'.repeat(80)}</think>Answer` }, finish_reason: 'stop' }] }, 10);
  assert.equal(estimated.thinkingTokens, 20);
  assert.equal(estimated.thinkingEstimated, true);
  assert.deepEqual(estimated.tools, []);
});

// A streaming model client whose calls follow a script: 'stall' sends no chunk until aborted,
// { firstMs, gapMs } streams a reply with those delays, an Error is thrown.
function stallingClient(script) {
  const calls = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (body, options = {}) => {
          const step = script[calls.length];
          calls.push({ body, signal: options.signal, timeout: options.timeout });
          if (step instanceof Error) throw step;
          const reply = completion({ content: `reply ${calls.length}` });
          return step === 'stall'
            ? streamOf(reply, { firstDelayMs: 1e9, signal: options.signal })
            : streamOf(reply, { firstDelayMs: step.firstMs, gapMs: step.gapMs ?? 0, signal: options.signal });
        },
      },
    },
  };
}

test('turns are streamed and reassembled into one completion with usage and tool calls', async () => {
  modelReply = () => completion({
    content: 'Adding it.',
    reasoning_content: 'SECRET',
    tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'view_schema', arguments: '{"a":1}' } }],
  }, 'tool_calls');
  const result = await completeTurn(fakeClient(), buildNvidiaRequest(leadBody()));
  const { message } = result.completion.choices[0];
  assert.equal(message.content, 'Adding it.');
  assert.equal(message.reasoning_content, 'SECRET');
  assert.deepEqual(message.tool_calls, [{ id: 'call-1', type: 'function', function: { name: 'view_schema', arguments: '{"a":1}' } }]);
  assert.equal(result.completion.choices[0].finish_reason, 'tool_calls');
  assert.equal(result.retried, false);
  assert.equal(typeof result.ttftMs, 'number');
});

test('a turn with no chunk by the first-chunk timeout is aborted and sent once more', async () => {
  const client = stallingClient(['stall', { firstMs: 5 }]);
  const result = await completeTurn(client, buildNvidiaRequest(leadBody()), { firstChunkTimeoutMs: 30 });
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].body.stream, true);
  assert.deepEqual(client.calls[0].body.stream_options, { include_usage: true });
  assert.equal(client.calls[0].signal.aborted, true);
  assert.equal(client.calls[1].signal.aborted, false);
  assert.equal(result.retried, true);
  assert.equal(result.completion.choices[0].message.content, 'reply 2');
  // Date.now() can read a timer as 1 ms short, so bounds allow 1 ms.
  assert.ok(result.firstAttemptMs >= 29 && result.retryMs >= 4);
  assert.ok(result.ttftMs >= 4);
  assert.equal(result.latencyMs, result.firstAttemptMs + result.retryMs);
});

test('once chunks are flowing a turn is never aborted, however long it runs', async () => {
  const client = stallingClient([{ firstMs: 5, gapMs: 25 }]);
  const result = await completeTurn(client, buildNvidiaRequest(leadBody()), { firstChunkTimeoutMs: 20 });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].signal.aborted, false);
  assert.equal(result.retried, false);
  assert.equal(result.completion.choices[0].message.content, 'reply 1');
  assert.ok(result.latencyMs >= 50, `ran ${result.latencyMs} ms past the 20 ms first-chunk timeout`);
  assert.ok(result.ttftMs < 20);
});

test('a slow retry runs to completion and is never aborted or retried again', async () => {
  const client = stallingClient(['stall', { firstMs: 60 }]);
  const result = await completeTurn(client, buildNvidiaRequest(leadBody()), { firstChunkTimeoutMs: 20 });
  assert.equal(client.calls.length, 2);
  assert.equal(result.completion.choices[0].message.content, 'reply 2');
  assert.ok(result.retryMs >= 60);
});

test('model errors are not retried', async () => {
  const failing = stallingClient([Object.assign(new Error('Bad gateway'), { status: 502 }), { firstMs: 1 }]);
  await assert.rejects(completeTurn(failing, buildNvidiaRequest(leadBody()), { firstChunkTimeoutMs: 1000 }), /Bad gateway/);
  assert.equal(failing.calls.length, 1);
});

test('latestToolResults reports the tool results a turn was sent with, errors and health issues first', () => {
  const messages = [
    { role: 'system', content: 'x' },
    { role: 'user', content: 'Add a pie chart.' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'old', type: 'function', function: { name: 'view_schema', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'old', content: '{"success":true,"response":"schema"}' },
    { role: 'assistant', content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'configure_widget', arguments: '{}' } },
      { id: 'c2', type: 'function', function: { name: 'configure_widget', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'c1', content: '{"success":false,"issues":[{"key":"validationExpectedOneOf","message":"Expected one of: orders.status","path":["value"]}]}' },
    { role: 'tool', tool_call_id: 'c2', content: '{"success":true,"response":"Configured","data":{"issues":[{"code":"data_mapping_complete","description":"Fields not mapped","score":0}]}}' },
  ];
  const results = latestToolResults(messages);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(({ tool, success, issues }) => ({ tool, success, issues })), [
    { tool: 'configure_widget', success: false, issues: ['Expected one of: orders.status'] },
    { tool: 'configure_widget', success: true, issues: ['data_mapping_complete: Fields not mapped (score 0)'] },
  ]);
  assert.ok(results[0].preview.startsWith('{"success":false'));
  assert.deepEqual(latestToolResults([{ role: 'user', content: 'hi' }]), []);
});

test('the proxy answers after a retry and logs time to first token, retries and tool results when STUDIO_AI_TIMING=1', async () => {
  const client = fakeAnthropic(['stall', { firstMs: 10 }]);
  claudeReply = (_body, call) => claudeMessage([{ type: 'text', text: `reply ${call}` }]);
  const logged = [];
  const originalLog = console.log;
  process.env.STUDIO_AI_TIMING = '1';
  console.log = (line) => logged.push(line);
  try {
    const response = await post(encodeRequest(fixtures.widget), { client: () => client, firstChunkTimeoutMs: 40 });
    assert.equal(response.status, 200);
    assert.equal(response.body.message.content, 'reply 2');
  } finally {
    console.log = originalLog;
    delete process.env.STUDIO_AI_TIMING;
  }
  const row = JSON.parse(logged.find((line) => line.startsWith('[studio-ai] ')).slice(12));
  assert.equal(row.agent, 'widget');
  assert.equal(row.model, STUDIO_AI_DEFAULT_MODEL);
  assert.equal(row.effort, STUDIO_AI_EFFORT);
  assert.equal(row.inputTokens, 100);
  assert.equal(row.outputTokens, 20);
  assert.equal(row.retried, true);
  assert.ok(row.firstAttemptMs >= 39 && row.retryMs >= 9);
  assert.ok(row.ttftMs >= 9);
  assert.equal(row.latencyMs, row.firstAttemptMs + row.retryMs);
  assert.deepEqual(row.toolResults.map((result) => result.tool), ['view_plan']);
  assert.equal(row.thinkingTokens, undefined);
});

// ---- Anthropic translation and streaming ----

test('history translates to Messages: system on top, tool calls as tool_use, one user message per tool round', () => {
  const request = buildAnthropicRequest({
    messages: [
      { role: 'system', content: 'Agent instructions.' },
      { role: 'user', content: 'Add a pie chart.' },
      { role: 'system', content: 'Report context.' },
      { role: 'assistant', content: '', tool_calls: [
        { id: 'run-1:preflight.0', type: 'function', function: { name: 'view_schema', arguments: '{}' } },
        { id: 'call_2', type: 'function', function: { name: 'view_page', arguments: '{"pageId":"p1"}' } },
      ] },
      { role: 'tool', tool_call_id: 'run-1:preflight.0', content: '{"success":true}' },
      { role: 'tool', tool_call_id: 'call_2', content: '{"success":true,"page":"p1"}' },
      { role: 'assistant', content: 'Adding it.', tool_calls: [{ id: 'call_3', type: 'function', function: { name: 'add_widget', arguments: 'not json' } }] },
      { role: 'tool', tool_call_id: 'call_3', content: '{"success":false}' },
      { role: 'user', content: 'Thanks' },
    ],
    tools: [{ type: 'function', function: { name: 'view_schema', description: 'Schema', parameters: { type: 'object', properties: {}, additionalProperties: false } } }],
  }, { model: 'claude-haiku-5-5', effort: 'medium' });

  assert.equal(request.model, 'claude-haiku-5-5');
  assert.deepEqual(request.output_config, { effort: 'medium' });
  assert.deepEqual(request.system.slice(1), [{ type: 'text', text: 'Agent instructions.' }, { type: 'text', text: 'Report context.' }]);
  assert.deepEqual(request.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Add a pie chart.' }] },
    { role: 'assistant', content: [
      { type: 'tool_use', id: 'run-1_preflight_0', name: 'view_schema', input: {} },
      { type: 'tool_use', id: 'call_2', name: 'view_page', input: { pageId: 'p1' } },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'run-1_preflight_0', content: '{"success":true}' },
      { type: 'tool_result', tool_use_id: 'call_2', content: '{"success":true,"page":"p1"}' },
    ] },
    { role: 'assistant', content: [{ type: 'text', text: 'Adding it.' }, { type: 'tool_use', id: 'call_3', name: 'add_widget', input: {} }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'call_3', content: '{"success":false}' },
      { type: 'text', text: 'Thanks' },
    ] },
  ]);
});

test("Studio's tools are sent as name, description and input_schema, unchanged and without strict", () => {
  const body = encodeRequest(fixtures.widget);
  const request = buildAnthropicRequest(body);
  assert.equal(request.tools.length, fixtures.widget.tools.length);
  request.tools.forEach((tool, index) => {
    const original = fixtures.widget.tools[index];
    assert.deepEqual(Object.keys(tool).sort(), ['description', 'input_schema', 'name']);
    assert.equal(tool.name, original.name);
    assert.deepEqual(tool.input_schema, original.parameters);
    assert.equal(tool.strict, undefined);
  });
});

test('forced tool choices become auto; none stays none; response_format maps to output_config.format', () => {
  const base = leadBody();
  const choiceFor = (toolChoice) => buildAnthropicRequest({ ...base, tool_choice: toolChoice }).tool_choice;
  assert.deepEqual(choiceFor('required'), { type: 'auto' });
  assert.deepEqual(choiceFor({ type: 'function', function: { name: 'view_schema' } }), { type: 'auto' });
  assert.deepEqual(choiceFor('auto'), { type: 'auto' });
  assert.deepEqual(choiceFor('none'), { type: 'none' });
  assert.equal(choiceFor(undefined), undefined);

  const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false };
  const withFormat = buildAnthropicRequest({ ...base, response_format: { type: 'json_schema', json_schema: { name: 'response', schema } } });
  assert.deepEqual(withFormat.output_config, { effort: STUDIO_AI_EFFORT, format: { type: 'json_schema', schema } });
  assert.equal(withFormat.response_format, undefined);
});

test('stop reasons map to finish reasons: tool_use -> tool_calls, max_tokens -> length, others -> stop', () => {
  assert.equal(toStudioReply(claudeMessage([], 'tool_use')).finish_reason, 'tool_calls');
  assert.equal(toStudioReply(claudeMessage([], 'max_tokens')).finish_reason, 'length');
  assert.equal(toStudioReply(claudeMessage([], 'end_turn')).finish_reason, 'stop');
  assert.equal(toStudioReply(claudeMessage([], 'stop_sequence')).finish_reason, 'stop');
  assert.throws(() => toStudioReply(claudeMessage([], 'refusal')), (error) => error.statusCode === 422 && error.message === REFUSAL_MESSAGE);
});

test('describeAnthropicTurn names every Studio agent and reports model, effort, tokens and tools', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const body = encodeRequest(fixture);
    const row = describeAnthropicTurn(body, buildAnthropicRequest(body), claudeMessage([{ type: 'tool_use', id: 't', name: 'view_schema', input: {} }], 'tool_use'), 1234);
    assert.equal(row.agent, name);
    assert.equal(row.latencyMs, 1234);
    assert.deepEqual(row.tools, ['view_schema']);
    assert.equal(row.finishReason, 'tool_use');
    assert.equal(row.inputTokens, 100);
  }
});

test('Claude turn: no content by the first-token timeout is aborted and sent once more (message_start does not count)', async () => {
  claudeReply = (_body, call) => claudeMessage([{ type: 'text', text: `reply ${call}` }]);
  const client = fakeAnthropic(['stall', { firstMs: 10 }]);
  const result = await completeAnthropicTurn(client, buildAnthropicRequest(leadBody()), { firstChunkTimeoutMs: 40 });
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].signal.aborted, true);
  assert.equal(client.calls[1].signal.aborted, false);
  assert.equal(result.retried, true);
  assert.equal(result.message.content[0].text, 'reply 2');
  // Date.now() can read a timer as 1 ms short, so bounds allow 1 ms.
  assert.ok(result.firstAttemptMs >= 39 && result.retryMs >= 9);
  assert.ok(result.ttftMs >= 9);
  assert.equal(result.latencyMs, result.firstAttemptMs + result.retryMs);
});

test('Claude turn: once content is flowing the first-token timer no longer applies; only the hard deadline does', async () => {
  claudeReply = () => claudeMessage([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'c' }]);
  const client = fakeAnthropic([{ firstMs: 5, gapMs: 80 }]);
  const result = await completeAnthropicTurn(client, buildAnthropicRequest(leadBody()), { firstChunkTimeoutMs: 100, turnTimeoutMs: 5000 });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].signal.aborted, false);
  assert.equal(client.calls[0].timeout, 5000, 'the SDK gets the same deadline as its request timeout');
  assert.equal(result.retried, false);
  assert.ok(result.latencyMs >= 159, `ran ${result.latencyMs} ms past the 100 ms timeout`);
  assert.ok(result.ttftMs < 100);
});

test('Claude turn: a turn that is still streaming at the hard deadline is aborted and ends as a 504', async () => {
  claudeReply = () => claudeMessage([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'c' }]);
  const client = fakeAnthropic([{ firstMs: 5, gapMs: 1e9 }]);
  const started = Date.now();
  await assert.rejects(
    completeAnthropicTurn(client, buildAnthropicRequest(leadBody()), { firstChunkTimeoutMs: 100, turnTimeoutMs: 150 }),
    { statusCode: 504, message: TIMEOUT_MESSAGE },
  );
  assert.ok(Date.now() - started < 1000, 'ended at the deadline');
  assert.equal(client.calls.length, 1, 'a turn cut off by the hard deadline is not retried');
  assert.equal(client.calls[0].signal.aborted, true);
});

test('Claude turn: a stalled first try and a stalled retry together end at the hard deadline as a 504', async () => {
  const client = fakeAnthropic(['stall', 'stall']);
  const started = Date.now();
  await assert.rejects(
    completeAnthropicTurn(client, buildAnthropicRequest(leadBody()), { firstChunkTimeoutMs: 40, turnTimeoutMs: 120 }),
    { statusCode: 504 },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 100 && elapsed < 1000, `ended after ${elapsed} ms`);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls[1].timeout <= 80, `the retry got the time left (${client.calls[1].timeout} ms), not a fresh budget`);
  assert.ok(client.calls.every((call) => call.signal.aborted));
});

test('the proxy answers a hard timeout with a clean 504 JSON error, never a hang', async () => {
  claudeReply = () => claudeMessage([{ type: 'text', text: 'late' }]);
  const started = Date.now();
  const { status, body } = await post(leadBody(), { client: () => fakeAnthropic(['stall']), firstChunkTimeoutMs: 1000, turnTimeoutMs: 60 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(status, 504);
  assert.deepEqual(body, { error: TIMEOUT_MESSAGE });
});

test('Claude turn: a slow retry runs to completion and is never retried again; model errors are not retried', async () => {
  const slow = fakeAnthropic(['stall', { firstMs: 60 }]);
  const result = await completeAnthropicTurn(slow, buildAnthropicRequest(leadBody()), { firstChunkTimeoutMs: 20 });
  assert.equal(slow.calls.length, 2);
  assert.ok(result.retryMs >= 59);

  const failing = fakeAnthropic([Object.assign(new Error('Overloaded'), { status: 529 }), { firstMs: 1 }]);
  await assert.rejects(completeAnthropicTurn(failing, buildAnthropicRequest(leadBody()), { firstChunkTimeoutMs: 1000 }), /Overloaded/);
  assert.equal(failing.calls.length, 1);
});

test('with the real Anthropic SDK against a local SSE server: stalled first try is retried, reply decodes', async () => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const requests = [];
  const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.post('/v1/messages', (request, response) => {
    requests.push(request.body);
    response.set('Content-Type', 'text/event-stream');
    response.write(sse('message_start', { message: { id: 'msg_local', type: 'message', role: 'assistant', model: request.body.model, content: [], stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } }));
    if (requests.length === 1) return; // first try: message_start only, then silence
    response.write(sse('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_local', name: 'view_schema', input: {} } }));
    response.write(sse('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }));
    response.write(sse('content_block_stop', { index: 0 }));
    response.write(sse('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 12 } }));
    response.end(sse('message_stop', {}));
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const client = new Anthropic({ apiKey: FAKE_KEY, baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const request = buildAnthropicRequest(leadBody());
    const result = await completeAnthropicTurn(client, request, { firstChunkTimeoutMs: 200 });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].stream, true);
    assert.deepEqual(requests[0].output_config, { effort: STUDIO_AI_EFFORT });
    assert.equal(result.retried, true);
    const reply = toStudioReply(result.message);
    assert.equal(reply.finish_reason, 'tool_calls');
    assert.deepEqual(reply.message.tool_calls, [{ id: 'toolu_local', type: 'function', function: { name: 'view_schema', arguments: '{}' } }]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SCOPE_NOTE tells the lead to delegate seat requests to the Seat agent first, with nothing before it', () => {
  const request = buildAnthropicRequest({ messages: [{ role: 'user', content: 'Buy 5 seats for the fall class' }] });
  const scope = request.system[0].text;
  assert.match(scope, /For any request to buy, order, price or refund seats, call delegate_to with type "seat" as your first action, with no other tool calls or commentary before it\./);
});
