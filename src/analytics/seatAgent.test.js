import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeatAgent, SEAT_AGENT_ID, seatSummary } from './seatAgent.js';

const PROPOSAL = { id: '11111111-1111-4111-8111-111111111111', quantity: 12, className: 'Fall class', unitPrice: '49.00', total: '588.00', currency: 'USD' };
const REPLY = 'Ready to order 12 seats at USD 49.00 each, USD 588.00 total. Click Confirm to continue to PayPal.';
const input = (content = 'Prepare an order for 12 seats for the Fall class.') => ({
  threadId: 'child-thread', runId: 'run-1', messages: [{ id: 'm1', role: 'user', content }],
});

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function fakeFetch(reply) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return reply();
    },
  };
}

test('a delegated run calls /api/agent/chat with the access token and emits the full event sequence', async () => {
  const { requests, fetchImpl } = fakeFetch(() => Response.json({ reply: REPLY, proposal: PROPOSAL }));
  const proposals = [];
  const agent = createSeatAgent({ getAccessToken: () => 'session-token', onProposal: (proposal) => proposals.push(proposal), fetchImpl });
  const events = await collect(agent.run(input(), { completeTask: { name: 'complete_task' } }));

  assert.equal(agent.id, SEAT_AGENT_ID);
  assert.equal(agent.name, 'Seat agent');
  assert.match(agent.description, /never places or pays/i);
  assert.equal(requests[0].url, '/api/agent/chat');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(requests[0].body, { messages: [{ role: 'user', content: 'Prepare an order for 12 seats for the Fall class.' }] });
  assert.deepEqual(proposals, [PROPOSAL]);

  assert.deepEqual(events.map((event) => event.type), [
    'RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
    'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT', 'RUN_FINISHED',
  ]);
  assert.deepEqual(events[0], { type: 'RUN_STARTED', threadId: 'child-thread', runId: 'run-1' });
  assert.equal(events[2].delta, REPLY);
  assert.equal(events[4].toolCallName, 'complete_task');
  const args = JSON.parse(events[5].delta);
  assert.equal(args.summary, seatSummary(REPLY, PROPOSAL));
  assert.match(args.summary, /nothing has been ordered or paid/);
  assert.deepEqual(args.artifacts.map((artifact) => [artifact.id, artifact.type]), [[PROPOSAL.id, 'seat-proposal']]);
  assert.equal(events[7].toolCallId, events[4].toolCallId);
  assert.equal(JSON.parse(events[7].content).data.summary, args.summary);
  assert.deepEqual(events.at(-1), { type: 'RUN_FINISHED', threadId: 'child-thread', runId: 'run-1' });
});

test('a run started directly (not delegated) emits no complete_task', async () => {
  const { fetchImpl } = fakeFetch(() => Response.json({ reply: 'Seats are USD 49.00 each.', proposal: null }));
  const events = await collect(createSeatAgent({ getAccessToken: () => 't', fetchImpl }).run(input('What does a seat cost?'), {}));
  assert.deepEqual(events.map((event) => event.type), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
});

test('reads text from content parts and sends only the last user message', async () => {
  const { requests, fetchImpl } = fakeFetch(() => Response.json({ reply: 'ok', proposal: null }));
  await collect(createSeatAgent({ getAccessToken: () => 't', fetchImpl }).run({
    threadId: 't', runId: 'r', messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'x' }, { role: 'user', content: [{ type: 'text', text: 'Buy 3 seats' }] }],
  }, {}));
  assert.deepEqual(requests[0].body.messages, [{ role: 'user', content: 'Buy 3 seats' }]);
});

test('a failed request reports the error to the chat and the lead, and shows no Confirm bar', async () => {
  const { fetchImpl } = fakeFetch(() => Response.json({ error: 'The Supabase access token is invalid or expired.' }, { status: 401 }));
  const proposals = [];
  const events = await collect(createSeatAgent({ getAccessToken: () => 'expired', onProposal: (p) => proposals.push(p), fetchImpl }).run(input(), { completeTask: { name: 'complete_task' } }));
  assert.deepEqual(proposals, []);
  assert.match(events[2].delta, /could not prepare an order: The Supabase access token is invalid or expired\./);
  assert.match(JSON.parse(events[7].content).data.summary, /could not prepare an order/);
  assert.deepEqual(JSON.parse(events[5].delta).artifacts, []);
  assert.equal(events.at(-1).type, 'RUN_FINISHED');
});

test('an aborted run stops without reporting an error', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const events = await collect(createSeatAgent({ getAccessToken: () => 't', fetchImpl }).run(input(), { signal: controller.signal, completeTask: { name: 'complete_task' } }));
  assert.deepEqual(events.map((event) => event.type), ['RUN_STARTED']);
});
