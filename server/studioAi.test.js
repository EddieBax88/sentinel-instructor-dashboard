import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { encodeRequest } from '../src/analytics/nvidiaAdapter.js';
import { AGENT_MODEL, AGENT_TEMPLATE_KWARGS } from './config.js';
import { createStudioAiRouter, sanitizeCompletion, STUDIO_TOOL_NAMES } from './studioAi.js';

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
        modelCalls.push(structuredClone(body));
        return modelReply(body);
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

async function post(body, { token = 'valid-token' } = {}) {
  const app = express();
  app.use('/api/studio-ai', createStudioAiRouter({ client: fakeClient }));
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
