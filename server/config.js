// Seats each class is planned around. A display and suggestion default only, never a purchase limit.
export const DEFAULT_CLASS_SIZE = 30;

// The only purchase cap: seats allowed in a single order.
export const MAX_SEATS_PER_ORDER = 200;

// Seat assistant model, served by NVIDIA's hosted OpenAI-compatible API (build.nvidia.com).
// NVIDIA's model card documents tool calling for this model.
export const AGENT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const AGENT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

// Required by NVIDIA's model card for this model to parse tool calls.
export const AGENT_TEMPLATE_KWARGS = { enable_thinking: true, force_nonempty_content: true };

// The AG Studio analytics agent (Ask AI) runs on Anthropic Claude through the Messages API.
// STUDIO_AI_MODEL in .env overrides the model without a code change (production does not set it).
// Sonnet 5.5 at effort low was measured live on Nov 3: 0 failed tool calls, where Haiku 5.5 had 2.
// Timings and the comparison are in HANDOFF.md.
export const STUDIO_AI_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const studioAiModel = () => process.env.STUDIO_AI_MODEL || STUDIO_AI_DEFAULT_MODEL;
// Thinking stays on (the model's default); effort sets how much it thinks per turn.
export const STUDIO_AI_EFFORT = 'low';
