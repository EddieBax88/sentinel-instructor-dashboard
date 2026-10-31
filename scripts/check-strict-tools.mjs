// Checks AG Studio's real tool schemas against Anthropic's strict tool use rules, offline.
//
//   npm run check:strict-tools
//
// Rules from platform.claude.com/docs/en/build-with-claude/structured-outputs (JSON Schema
// limitations, Schema complexity limits), read 2026-10-31:
// - every object needs additionalProperties: false
// - not supported: recursive schemas, numerical constraints (minimum, maximum, multipleOf, ...),
//   string length constraints, array constraints beyond minItems 0 or 1, complex enum values,
//   external $ref, allOf containing $ref; keywords outside the supported list (e.g. `not`, `oneOf`)
// - per request, across all strict schemas: at most 20 strict tools, 24 optional parameters,
//   16 parameters with union types (anyOf or type arrays)
// Input: scripts/fixtures/studio-agent-requests.json (the first turn of each Studio agent).

import { readFileSync } from 'node:fs';

const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength',
  'maxItems', 'uniqueItems', 'contains', 'prefixItems', 'oneOf', 'not', 'if', 'then', 'else', 'patternProperties',
  'propertyNames', 'minProperties', 'maxProperties', 'dependentSchemas', 'dependentRequired'];
const LIMITS = { strictTools: 20, optional: 24, unions: 16 };

// Walks one tool's parameter schema. Returns rule problems and the counts the request limits use.
export function checkSchema(root) {
  const problems = [];
  let optional = 0;
  let unions = 0;
  const defs = { ...(root.definitions ?? {}), ...(root.$defs ?? {}) };

  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    for (const key of UNSUPPORTED) if (key in node) problems.push(`${path}: ${key} ${JSON.stringify(node[key])}`);
    if ('minItems' in node && node.minItems !== 0 && node.minItems !== 1) problems.push(`${path}: minItems ${node.minItems}`);
    if (typeof node.format === 'string' && !SUPPORTED_FORMATS.has(node.format)) problems.push(`${path}: format ${node.format}`);
    if (Array.isArray(node.enum) && node.enum.some((value) => value !== null && typeof value === 'object')) problems.push(`${path}: enum with complex values`);
    if (typeof node.$ref === 'string' && !node.$ref.startsWith('#')) problems.push(`${path}: external $ref`);
    if (Array.isArray(node.allOf) && JSON.stringify(node.allOf).includes('"$ref"')) problems.push(`${path}: allOf with $ref`);
    if (node.anyOf || Array.isArray(node.type)) unions += 1;
    if (node.type === 'object' || node.properties) {
      if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties is ${JSON.stringify(node.additionalProperties)}, must be false`);
      const required = new Set(node.required ?? []);
      for (const [name, child] of Object.entries(node.properties ?? {})) {
        if (!required.has(name)) optional += 1;
        visit(child, `${path}.${name}`);
      }
    }
    if (node.items) visit(node.items, `${path}[]`);
    for (const key of ['anyOf', 'allOf', 'oneOf']) (node[key] ?? []).forEach((child, index) => visit(child, `${path}.${key}[${index}]`));
  };

  visit(root, '');
  for (const [name, def] of Object.entries(defs)) visit(def, `$defs.${name}`);

  // Recursion: a $def that reaches itself through $refs.
  const refsOf = (value) => [...JSON.stringify(value ?? {}).matchAll(/"#\/(?:\$defs|definitions)\/([^"]+)"/g)].map((match) => match[1]);
  for (const name of Object.keys(defs)) {
    const seen = new Set();
    const stack = refsOf(defs[name]);
    while (stack.length) {
      const next = stack.pop();
      if (next === name) {
        problems.push(`$defs.${name}: recursive`);
        break;
      }
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(...refsOf(defs[next]));
      }
    }
  }
  return { problems, optional, unions };
}

// One agent request: every tool checked, and the per-request totals against the limits.
export function checkRequest(tools) {
  const perTool = tools.map((tool) => ({ name: tool.name, ...checkSchema(tool.parameters ?? { type: 'object', properties: {} }) }));
  const totals = {
    strictTools: tools.length,
    optional: perTool.reduce((sum, row) => sum + row.optional, 0),
    unions: perTool.reduce((sum, row) => sum + row.unions, 0),
  };
  const overLimits = Object.entries(LIMITS).filter(([key, limit]) => totals[key] > limit).map(([key, limit]) => `${key} ${totals[key]} > ${limit}`);
  return { perTool, totals, overLimits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/studio-agent-requests.json', import.meta.url), 'utf8'));
  let failing = 0;
  for (const [agent, request] of Object.entries(fixtures)) {
    const { perTool, totals, overLimits } = checkRequest(request.tools);
    console.log(`\n${agent}: ${request.tools.length} tools, ${totals.optional} optional params, ${totals.unions} union params${overLimits.length ? `  OVER LIMIT: ${overLimits.join(', ')}` : ''}`);
    for (const row of perTool) {
      const unique = [...new Set(row.problems)];
      console.log(`  ${unique.length ? 'FAIL' : 'ok  '} ${row.name.padEnd(22)} optional ${String(row.optional).padStart(3)}  unions ${String(row.unions).padStart(3)}`);
      for (const problem of unique.slice(0, 6)) console.log(`         ${problem}`);
      if (unique.length > 6) console.log(`         ...and ${unique.length - 6} more`);
    }
    if (overLimits.length || perTool.some((row) => row.problems.length)) failing += 1;
  }
  console.log(`\n${failing} of ${Object.keys(fixtures).length} agent requests would not pass strict tool use as sent.`);
}
