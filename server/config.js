// Seats each class is planned around. A display and suggestion default only, never a purchase limit.
export const DEFAULT_CLASS_SIZE = 30;

// The only purchase cap: seats allowed in a single order.
export const MAX_SEATS_PER_ORDER = 200;

// Seat assistant model, served by NVIDIA's hosted OpenAI-compatible API (build.nvidia.com).
// NVIDIA's model card documents tool calling for this model.
export const AGENT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const AGENT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

// AG Studio analytics agent (Instructor analytics chat), on the same NVIDIA endpoint. Studio's
// agents take many tool-calling rounds per question, so this uses Nemotron 3 Super: NVIDIA lists
// it for agentic tool use with 12B active parameters (Ultra has 55B), so each round is faster.
// Run `npm run probe:studio-agent` to compare models on Studio's real tool definitions.
export const STUDIO_AGENT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
export const STUDIO_AGENT_TEMPLATE_KWARGS = { enable_thinking: true, force_nonempty_content: true };
