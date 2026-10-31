// AG Studio's five built-in agents, tuned for fewer and shorter model turns. Each one starts with
// the report, schema and current page already loaded (as tool results Studio fetches in the
// browser before the first turn), is told not to look them up again or re-check its own work, and
// keeps its reports to one short plain sentence. Everything else about the agents is Studio's.

// Context every agent gets up front, where it has the tool. Studio runs these locally: no model turn.
export const PRELOADED_TOOLS = ['view_report', 'view_schema', 'view_page'];

const SPEED_RULES = `## Speed rules for this dashboard (these override any rule above)
- The report pages, data schema and current page layout are already loaded above as tool results. Do not call view_report, view_schema or view_page to look them up again.`;

const LEAD_RULES = `- Do not call view_page before answering or to verify finished work, including after a plan; the sub-agents' summaries tell you what changed.
- Your final message to the user is one short sentence in plain language saying what you did or found. No widget health scores, display states, field IDs or other internal terms. Do not list next steps.`;

const NO_RECHECK_RULES = `- Do not call view_page or view_widget after acting to check your work; a tool reports an error when something fails. Call complete_task as soon as the change is made.`;

const SUMMARY_RULES = `- Your complete_task summary is one short plain sentence: what you changed or found, plus the widget id of any widget you created. No scores, health details or analysis.`;

const EXTRA_RULES = {
  lead: [SPEED_RULES, LEAD_RULES],
  data: [SPEED_RULES, SUMMARY_RULES],
  page: [SPEED_RULES, NO_RECHECK_RULES, SUMMARY_RULES],
  widget: [SPEED_RULES, NO_RECHECK_RULES, SUMMARY_RULES],
  planning: [SPEED_RULES, SUMMARY_RULES],
};

export function tuneAgent(definition) {
  const rules = EXTRA_RULES[definition.id];
  if (!rules) return definition;
  return {
    ...definition,
    instructions: (ctx, params) => [definition.instructions?.(ctx, params), ...rules].filter(Boolean).join('\n\n'),
    defaultToolCalls: (ctx, params) => {
      const own = definition.defaultToolCalls?.(ctx, params) ?? [];
      const available = new Set((definition.tools?.(ctx, params) ?? []).map((tool) => tool.name));
      const preload = PRELOADED_TOOLS
        .filter((name) => available.has(name) && !own.some((call) => call.tool === name))
        .map((tool) => ({ tool }));
      return [...preload, ...own];
    },
  };
}

// The createAiHarness config builder: Studio's agents, tuned, each on the given adapter.
export function studioHarnessConfig({ builtIn }, { adapter, directLlmRunner, promptStarters }) {
  return {
    agents: Object.values(builtIn).map((definition) => directLlmRunner({ ...tuneAgent(definition), adapter })),
    primary: 'lead',
    promptStarters,
  };
}
