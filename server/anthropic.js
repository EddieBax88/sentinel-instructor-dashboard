import Anthropic from '@anthropic-ai/sdk';

let client;

export function isAnthropicConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// One server-side client for Anthropic's Messages API (Ask AI). The key is read from the
// environment here and never leaves the server.
export function anthropicClient(feature = 'the analytics assistant') {
  if (!isAnthropicConfigured()) {
    throw Object.assign(new Error(`Set ANTHROPIC_API_KEY in .env to enable ${feature}.`), { statusCode: 503 });
  }
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
