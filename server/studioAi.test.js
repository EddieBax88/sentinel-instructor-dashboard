import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { encodeRequest } from '../src/analytics/nvidiaAdapter.js';
import { AGENT_MODEL, AGENT_TEMPLATE_KWARGS } from './config.js';
import { buildNvidiaRequest, completeTurn, createStudioAiRouter, describeTurn, latestToolResults, sanitizeCompletion, STUDIO_TOOL_NAMES } from './studioAi.js';

const FAKE_KEY = 'nvapi-test-key-that-must-never-reach-the-browser';
const INSTRUCTOR = '00000000-0000-4000-8000-00000000000a';
const fixtures = JSON.parse(readFileSync(new URL('../scripts/fixtures/studio-agent-requests.json', import.meta.url), 'utf8'));
const originalFetch = globalThis.fetch;
const environmentNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NVIDIA_API_KEY'];
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

let modelCalls;
let modelReply;

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

async function post(body, { token = 'valid-token', client = fakeClient, firstChunkTimeoutMs } = {}) {
  const app = express();
  app.use('/api/studio-ai', createStudioAiRouter({ client, firstChunkTimeoutMs }));
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
  assert.equal(modelCalls.length, 0);
});

test("the server picks the model and settings; the client's model, token cap, and key fields are ignored", async () => {
  const { status } = await post({ ...leadBody(), model: 'some/other-model', max_tokens: 999999, api_key: 'client-key', chat_template_kwargs: { x: 1 } });

  assert.equal(status, 200);
  const [sent] = modelCalls;
  assert.equal(sent.model, AGENT_MODEL);
  assert.equal(sent.max_tokens, 16384);
  assert.deepEqual(sent.chat_template_kwargs, AGENT_TEMPLATE_KWARGS);
  assert.equal(sent.api_key, undefined);
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /cannot buy seats, create orders, or take payments/);
  assert.equal(sent.messages[1].content, fixtures.lead.instructions);
  assert.deepEqual(sent.tools.map((tool) => tool.function.name), fixtures.lead.tools.map((tool) => tool.name));
});

test('the NVIDIA key never appears in a response, including error responses', async () => {
  modelReply = () => completion({ content: 'Here is your chart.' });
  const ok = await post(leadBody());
  assert.equal(ok.status, 200);

  modelReply = () => { throw Object.assign(new Error(`401 Invalid key ${FAKE_KEY}`), { status: 401 }); };
  const failed = await post(leadBody());
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /analytics model request failed/);

  for (const response of [ok, failed]) {
    assert.ok(!response.text.includes(FAKE_KEY));
    assert.ok(!response.headers.includes(FAKE_KEY));
  }
});

test('strips reasoning text and reasoning fields before replying', async () => {
  modelReply = () => completion({
    content: 'Let me check the schema first.</think>Revenue by class is ready.',
    reasoning_content: 'SECRET chain of thought',
    reasoning: 'SECRET too',
  });
  const { body, text } = await post(leadBody());
  assert.equal(body.message.content, 'Revenue by class is ready.');
  assert.ok(!text.includes('SECRET'));
  assert.ok(!text.includes('think'));
});

test('passes Studio tool calls through and drops any tool the model invents', async () => {
  modelReply = () => completion({
    content: '',
    tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'view_schema', arguments: '{}' } },
      { id: 'call-2', type: 'function', function: { name: 'create_seat_order', arguments: '{"quantity":5}' } },
    ],
  }, 'tool_calls');
  const { body } = await post(leadBody());
  assert.deepEqual(body.message.tool_calls, [{ id: 'call-1', type: 'function', function: { name: 'view_schema', arguments: '{}' } }]);
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
  assert.equal(modelCalls.length, 0);
});

test("accepts Studio's largest real request (widget agent, ~56 KB)", async () => {
  const body = encodeRequest(fixtures.widget);
  assert.ok(JSON.stringify(body).length > 50_000);
  const { status } = await post(body);
  assert.equal(status, 200);
  assert.equal(modelCalls[0].tools.length, fixtures.widget.tools.length);
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
          calls.push({ body, signal: options.signal });
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
  assert.ok(result.firstAttemptMs >= 30 && result.retryMs >= 5);
  assert.ok(result.ttftMs >= 5);
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
  const client = stallingClient(['stall', { firstMs: 5 }]);
  const logged = [];
  const originalLog = console.log;
  process.env.STUDIO_AI_TIMING = '1';
  console.log = (line) => logged.push(line);
  try {
    const response = await post(encodeRequest(fixtures.widget), { client: () => client, firstChunkTimeoutMs: 30 });
    assert.equal(response.status, 200);
    assert.equal(response.body.message.content, 'reply 2');
  } finally {
    console.log = originalLog;
    delete process.env.STUDIO_AI_TIMING;
  }
  const row = JSON.parse(logged.find((line) => line.startsWith('[studio-ai] ')).slice(12));
  assert.equal(row.agent, 'widget');
  assert.equal(row.retried, true);
  assert.ok(row.firstAttemptMs >= 30 && row.retryMs >= 5);
  assert.ok(row.ttftMs >= 5);
  assert.equal(row.latencyMs, row.firstAttemptMs + row.retryMs);
  assert.deepEqual(row.toolResults.map((result) => result.tool), ['view_plan']);
});
