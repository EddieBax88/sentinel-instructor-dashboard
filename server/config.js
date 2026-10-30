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

// The AG Studio analytics agent (Ask AI) uses the same model and settings as the seat assistant.
// `npm run probe:studio-agent` checks this model on Studio's real tool definitions.
