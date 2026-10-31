import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRELOADED_TOOLS, studioHarnessConfig, tuneAgent } from './studioAgents.js';

const fixtures = JSON.parse(readFileSync(new URL('../../scripts/fixtures/studio-agent-requests.json', import.meta.url), 'utf8'));

// Stand-ins for Studio's built-in definitions, with the tool lists and default calls AG Studio 3.0 gives them.
const OWN_DEFAULTS = {
  page: [{ tool: 'view_page' }, { tool: 'view_plan' }],
  planning: [{ tool: 'view_plan' }],
  widget: [{ tool: 'view_widget', args: { widgetId: 'w-1' } }, { tool: 'view_plan' }],
};
const builtIn = Object.fromEntries(Object.entries(fixtures).map(([id, request]) => [id, {
  id,
  name: id,
  instructions: () => request.instructions,
  tools: () => request.tools.map((tool) => ({ name: tool.name })),
  ...(OWN_DEFAULTS[id] && { defaultToolCalls: () => OWN_DEFAULTS[id] }),
}]));
const tuned = (id) => tuneAgent(builtIn[id]);
const calls = (id) => tuned(id).defaultToolCalls({}, {}).map((call) => call.tool);

test('every agent starts with the report, schema and page it can view, keeping its own default calls', () => {
  assert.deepEqual(calls('lead'), ['view_report', 'view_schema', 'view_page']);
  assert.deepEqual(calls('data'), ['view_schema']);
  assert.deepEqual(calls('page'), ['view_schema', 'view_page', 'view_plan']);
  assert.deepEqual(calls('widget'), ['view_schema', 'view_widget', 'view_plan']);
  assert.deepEqual(tuned('widget').defaultToolCalls({}, {}).find((call) => call.tool === 'view_widget').args, { widgetId: 'w-1' });
  assert.deepEqual(calls('planning'), ['view_report', 'view_schema', 'view_page', 'view_plan']);
  for (const [id, request] of Object.entries(fixtures)) {
    const offered = new Set(request.tools.map((tool) => tool.name));
    assert.ok(calls(id).every((name) => offered.has(name)), `${id} preloads only tools it has`);
  }
  assert.deepEqual(PRELOADED_TOOLS, ['view_report', 'view_schema', 'view_page']);
});

test("instructions keep Studio's prompt and add the speed, no-recheck and short-summary rules", () => {
  for (const id of Object.keys(fixtures)) {
    const text = tuned(id).instructions({}, {});
    assert.ok(text.startsWith(fixtures[id].instructions), `${id} keeps Studio's instructions first`);
    assert.match(text, /already loaded above as tool results\. Do not call view_report, view_schema or view_page/);
  }
  assert.match(tuned('lead').instructions({}, {}), /Do not call view_page before answering/);
  assert.match(tuned('lead').instructions({}, {}), /final message to the user is one short sentence in plain language/);
  for (const id of ['page', 'widget']) assert.match(tuned(id).instructions({}, {}), /Do not call view_page or view_widget after acting/);
  for (const id of ['data', 'page', 'widget', 'planning']) assert.match(tuned(id).instructions({}, {}), /complete_task summary is one short plain sentence/);
  assert.doesNotMatch(tuned('lead').instructions({}, {}), /complete_task summary/);
});

test('the harness config runs all five tuned agents on one adapter, starting from lead', () => {
  const adapter = { executeTurn() {} };
  const runner = (config) => ({ ...config, run: () => {} });
  const config = studioHarnessConfig({ builtIn }, { adapter, directLlmRunner: runner, promptStarters: [{ label: 'x', prompt: 'y' }] });
  assert.equal(config.primary, 'lead');
  assert.deepEqual(config.agents.map((agent) => agent.id).sort(), ['data', 'lead', 'page', 'planning', 'widget']);
  assert.ok(config.agents.every((agent) => agent.adapter === adapter && agent.name && typeof agent.run === 'function'));
  assert.deepEqual(config.promptStarters, [{ label: 'x', prompt: 'y' }]);
});
