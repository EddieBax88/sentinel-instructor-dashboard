// Live check of NVIDIA models on AG Studio's real agent requests, before relying on one in the UI.
//
//   npm run probe:studio-agent              (2 trials per case)
//   TRIALS=3 npm run probe:studio-agent
//
// scripts/fixtures/studio-agent-requests.json holds the first turn of each AG Studio 3.0 agent
// (lead, data, widget, page, planning) as Studio sent it, captured in a browser with sample data.
// Each case goes through the same adapter encoding and proxy request builder as the app, straight
// to NVIDIA with NVIDIA_API_KEY from .env. A call passes when it returns at least one tool call
// whose name is offered in that request, with JSON-object arguments holding the tool's required
// fields. Nothing is written anywhere; the key is only sent to NVIDIA.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { encodeRequest } from '../src/analytics/nvidiaAdapter.js';
import { AGENT_MODEL, STUDIO_AGENT_MODEL } from '../server/config.js';
import { nvidiaClient } from '../server/nvidia.js';
import { buildNvidiaRequest, sanitizeCompletion } from '../server/studioAi.js';

const TRIALS = Number(process.env.TRIALS) || 2;
const TIMEOUT_MS = 120_000;
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/studio-agent-requests.json', import.meta.url), 'utf8'));
const THINKING = { enable_thinking: true, force_nonempty_content: true };

const variants = [
  { label: 'Ultra, thinking on (seat agent model)', model: AGENT_MODEL, templateKwargs: THINKING },
  { label: 'Super, thinking on', model: STUDIO_AGENT_MODEL, templateKwargs: THINKING },
  { label: 'Super, thinking off', model: STUDIO_AGENT_MODEL, templateKwargs: { enable_thinking: false } },
  { label: 'Super, thinking on, $refs inlined', model: STUDIO_AGENT_MODEL, templateKwargs: THINKING, inlineRefs: true },
];

function checkToolCalls(request, message) {
  const calls = message.tool_calls ?? [];
  if (!calls.length) return `no tool call (text: ${JSON.stringify((message.content || '').slice(0, 80))})`;
  for (const call of calls) {
    const tool = request.tools.find((candidate) => candidate.name === call.function.name);
    if (!tool) return `unknown tool ${call.function.name}`;
    let args;
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      return `${tool.name}: arguments are not JSON`;
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return `${tool.name}: arguments are not an object`;
    const missing = (tool.parameters?.required ?? []).filter((key) => !(key in args));
    if (missing.length) return `${tool.name}: missing ${missing.join(', ')}`;
  }
  return null;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN;
};

const client = nvidiaClient('the probe');
const results = [];
console.log(`Probing ${variants.length} settings x ${Object.keys(fixtures).length} Studio agents x ${TRIALS} trials. This can take several minutes.\n`);

for (const variant of variants) {
  for (const [agent, request] of Object.entries(fixtures)) {
    const row = { variant: variant.label, agent, passes: 0, times: [], problems: [] };
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const body = buildNvidiaRequest(encodeRequest(request, { inlineRefs: variant.inlineRefs }), variant);
      const started = performance.now();
      try {
        const completion = await client.chat.completions.create(body, { timeout: TIMEOUT_MS, maxRetries: 0 });
        row.times.push((performance.now() - started) / 1000);
        const problem = checkToolCalls(request, sanitizeCompletion(completion).message);
        if (problem) row.problems.push(problem);
        else row.passes += 1;
      } catch (error) {
        row.times.push((performance.now() - started) / 1000);
        row.problems.push(`error ${error.status ?? ''} ${error.message}`.slice(0, 120));
      }
      process.stdout.write('.');
    }
    results.push(row);
  }
}

console.log('\n');
console.log('setting'.padEnd(40), 'agent'.padEnd(9), 'pass'.padEnd(6), 'median s'.padEnd(9), 'max s'.padEnd(7), 'problems');
for (const row of results) {
  console.log(
    row.variant.padEnd(40), row.agent.padEnd(9), `${row.passes}/${TRIALS}`.padEnd(6),
    median(row.times).toFixed(1).padEnd(9), Math.max(...row.times).toFixed(1).padEnd(7), [...new Set(row.problems)].join(' | '),
  );
}

console.log('\nSummary (a question usually takes 4-10 of these turns):');
for (const variant of variants) {
  const rows = results.filter((row) => row.variant === variant.label);
  const passes = rows.reduce((sum, row) => sum + row.passes, 0);
  const total = rows.length * TRIALS;
  console.log(`  ${variant.label.padEnd(40)} ${passes}/${total} valid tool calls, median turn ${median(rows.flatMap((row) => row.times)).toFixed(1)} s`);
}
