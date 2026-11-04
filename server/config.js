// Seats each class is planned around. A display and suggestion default only, never a purchase limit.
export const DEFAULT_CLASS_SIZE = 30;

// The only purchase cap: seats allowed in a single order.
export const MAX_SEATS_PER_ORDER = 200;

// Scripts only: the NVIDIA hosted model (build.nvidia.com, OpenAI-compatible) that the probe and
// timing scripts keep as a baseline through server/nvidia.js. Nothing in the app calls it: on
// Nov 4 its free endpoint stalled during generation and three /api/agent/chat requests ran to
// Vercel's 300 s limit, so the seat assistant moved to Claude (below) with hard timeouts.
export const AGENT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const AGENT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
// Required by NVIDIA's model card for this model to parse tool calls.
export const AGENT_TEMPLATE_KWARGS = { enable_thinking: true, force_nonempty_content: true };

// Both assistants, the seat assistant (server/agent.js) and the AG Studio analytics agent
// (Ask AI, server/studioAi.js), run on Anthropic Claude through the Messages API with the same
// model and effort. STUDIO_AI_MODEL in .env overrides the model without a code change
// (production does not set it). Sonnet 5.5 at effort low was measured live on Nov 3: 0 failed
// tool calls, where Haiku 5.5 had 2. Timings and the comparison are in HANDOFF.md.
export const STUDIO_AI_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const studioAiModel = () => process.env.STUDIO_AI_MODEL || STUDIO_AI_DEFAULT_MODEL;
// Thinking stays on (the model's default); effort sets how much it thinks per turn.
export const STUDIO_AI_EFFORT = 'low';

// Hard deadlines on every model call, so a stalled upstream ends as a clean 504 and never a hang
// (Vercel's function limit is 300 s; the browser must see an answer or an error well inside 60 s).
// One seat-assistant model call; the tool loop makes up to six of them.
export const MODEL_CALL_TIMEOUT_MS = 20_000;
// All model calls of one /api/agent/chat request together.
export const AGENT_REQUEST_BUDGET_MS = 40_000;
// One Ask AI turn (/api/studio-ai/chat): the first try and its retry together.
export const STUDIO_AI_TURN_TIMEOUT_MS = 45_000;
