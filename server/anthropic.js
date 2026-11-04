import Anthropic from '@anthropic-ai/sdk';
import { STUDIO_AI_TURN_TIMEOUT_MS } from './config.js';

let client;

export function isAnthropicConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// One server-side client for Anthropic's Messages API (the seat assistant and Ask AI). The key is
// read from the environment here and never leaves the server. The client-wide timeout and the
// single retry are the outer bound; each call also carries its own AbortSignal deadline
// (server/agent.js, server/studioAi.js), so no request can outlive its budget.
export function anthropicClient(feature = 'the analytics assistant') {
  if (!isAnthropicConfigured()) {
    throw Object.assign(new Error(`Set ANTHROPIC_API_KEY in .env to enable ${feature}.`), { statusCode: 503 });
  }
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: STUDIO_AI_TURN_TIMEOUT_MS, maxRetries: 1 });
  return client;
}
