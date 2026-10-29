import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCompletion, encodeRequest, inlineSchemaRefs, nvidiaStudioAdapter } from './nvidiaAdapter.js';

const fixtures = JSON.parse(readFileSync(new URL('../../scripts/fixtures/studio-agent-requests.json', import.meta.url), 'utf8'));

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("encodes a real Studio turn as Chat Completions messages with paired tool calls and results", () => {
  const request = fixtures.widget;
  const body = encodeRequest(request);

  assert.deepEqual(body.messages[0], { role: 'system', content: request.instructions });
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.messages[1].content, 'Show revenue by class as a column chart.');

  const calls = request.input.filter((item) => item.type === 'function_call');
  const assistantCalls = body.messages.filter((message) => message.tool_calls).flatMap((message) => message.tool_calls);
  assert.deepEqual(assistantCalls.map((call) => [call.id, call.function.name]), calls.map((call) => [call.callId, call.name]));
  const results = body.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(results.map((message) => message.tool_call_id), request.input.filter((item) => item.type === 'function_call_output').map((item) => item.callId));
  for (const [index, message] of body.messages.entries()) {
    if (message.role === 'tool') assert.ok(body.messages.slice(0, index).some((m) => m.tool_calls?.some((call) => call.id === message.tool_call_id)));
  }

  assert.deepEqual(body.tools.map((tool) => tool.function.name), request.tools.map((tool) => tool.name));
  assert.equal(body.tools[0].type, 'function');
  assert.equal(body.tool_choice, undefined);
  assert.equal(body.response_format, undefined);
});

test('merges consecutive tool calls into one assistant turn and maps tool choice and JSON output', () => {
  const body = encodeRequest({
    instructions: 'Be brief.',
    input: [
      { kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { kind: 'output', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Checking.' }] },
      { kind: 'output', type: 'function_call', callId: 'a', name: 'view_schema', arguments: '' },
      { kind: 'output', type: 'function_call', callId: 'b', name: 'view_page', arguments: '{"pageId":"overview"}' },
      { kind: 'output', type: 'reasoning', summary: [{ type: 'summary', text: 'private' }] },
      { type: 'function_call_output', callId: 'a', output: { ok: true } },
      { type: 'function_call_output', callId: 'b', output: 'page ok' },
    ],
    tools: [],
    toolChoice: { name: 'view_schema' },
    responseFormat: { type: 'json_schema', name: 'title', schema: { type: 'object' } },
  });

  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Hi' },
    {
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'view_schema', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'view_page', arguments: '{"pageId":"overview"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' },
    { role: 'tool', tool_call_id: 'b', content: 'page ok' },
  ]);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'view_schema' } });
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'title', schema: { type: 'object' } } });
  assert.ok(!JSON.stringify(body).includes('private'));
});

test('decodes text and tool calls into Studio events and output items', () => {
  const { events, response } = decodeCompletion({
    id: 'cmpl-1',
    model: 'nvidia/nemotron-3-super-120b-a12b',
    finish_reason: 'tool_calls',
    message: { role: 'assistant', content: 'Adding a chart.', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'add_widget', arguments: '{"widgetType":"column-chart-grouped"}' } }] },
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

  assert.deepEqual(events.map((event) => event.type), [
    'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END',
  ]);
  assert.equal(events[1].delta, 'Adding a chart.');
  assert.deepEqual(events[3], { type: 'TOOL_CALL_START', toolCallId: 'call-1', toolCallName: 'add_widget' });
  assert.equal(response.status, 'completed');
  assert.deepEqual(response.output[1], {
    id: 'call-1', kind: 'output', type: 'function_call', callId: 'call-1', name: 'add_widget', arguments: '{"widgetType":"column-chart-grouped"}', status: 'completed',
  });
  assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test('marks a length-truncated turn incomplete and gives tool calls without ids an id', () => {
  const { response, events } = decodeCompletion({ finish_reason: 'length', message: { content: '', tool_calls: [{ function: { name: 'view_schema' } }] } });
  assert.equal(response.status, 'incomplete');
  assert.deepEqual(response.incompleteDetails, { reason: 'max_output_tokens' });
  assert.ok(events[0].toolCallId);
  assert.equal(response.output[0].arguments, '{}');
});

test('the adapter posts to the proxy with the session token only, then streams the decoded turn', async () => {
  const requests = [];
  const adapter = nvidiaStudioAdapter({
    getAccessToken: () => 'session-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({ id: 'cmpl-1', finish_reason: 'stop', message: { role: 'assistant', content: 'Revenue is highest for Fall class.' } });
    },
  });

  const handler = adapter.executeTurn(fixtures.lead);
  const events = await collect(handler.stream);
  const response = await handler.complete;

  assert.equal(requests[0].url, '/api/studio-ai/chat');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer session-token');
  const sent = JSON.parse(requests[0].options.body);
  assert.equal(sent.model, undefined);
  assert.ok(!/nvapi|api_key|NVIDIA_API_KEY/.test(requests[0].options.body));
  assert.equal(events.find((event) => event.type === 'TEXT_MESSAGE_CONTENT').delta, 'Revenue is highest for Fall class.');
  assert.equal(response.output[0].content[0].text, 'Revenue is highest for Fall class.');
});

test('a failed turn rejects complete with the server message and ends the stream cleanly', async () => {
  const adapter = nvidiaStudioAdapter({
    getAccessToken: () => 'expired',
    fetchImpl: async () => Response.json({ error: 'The Supabase access token is invalid or expired.' }, { status: 401 }),
  });
  const handler = adapter.executeTurn(fixtures.lead);
  assert.deepEqual(await collect(handler.stream), []);
  await assert.rejects(handler.complete, /invalid or expired/);
});

test('inlineSchemaRefs inlines non-recursive definitions and keeps recursive ones referenced', () => {
  const schema = {
    type: 'object',
    properties: { axis: { $ref: '#/$defs/Axis' }, filter: { $ref: '#/$defs/Filter' } },
    $defs: {
      Axis: { type: 'object', properties: { label: { $ref: '#/$defs/Label' } } },
      Label: { type: 'string' },
      Filter: { anyOf: [{ type: 'string' }, { type: 'array', items: { $ref: '#/$defs/Filter' } }] },
    },
  };
  const inlined = inlineSchemaRefs(schema);
  assert.deepEqual(inlined.properties.axis, { type: 'object', properties: { label: { type: 'string' } } });
  assert.deepEqual(inlined.properties.filter, { $ref: '#/$defs/Filter' });
  assert.deepEqual(Object.keys(inlined.$defs), ['Filter']);
  assert.equal(inlineSchemaRefs({ type: 'object' }).type, 'object');
});
