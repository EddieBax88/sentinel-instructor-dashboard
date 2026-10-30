import OpenAI from 'openai';
import { AGENT_BASE_URL } from './config.js';

let client;

export function isNvidiaConfigured() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

// One server-side client for NVIDIA's hosted OpenAI-compatible API. The key is read from the
// environment here and never leaves the server.
export function nvidiaClient(feature = 'the AI assistant') {
  if (!isNvidiaConfigured()) {
    throw Object.assign(new Error(`Set NVIDIA_API_KEY in .env to enable ${feature}.`), { statusCode: 503 });
  }
  client ??= new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: AGENT_BASE_URL });
  return client;
}

// Only message.content becomes reply text; reasoning fields (reasoning_content, reasoning) are
// never read. The chat template opens <think> in the prompt, so content can start with bare
// reasoning that ends at </think>: drop everything up to the last </think>, any complete
// <think>...</think> block, and anything after an unclosed <think>.
export function replyText(content) {
  let text = typeof content === 'string' ? content : '';
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const closing = text.toLowerCase().lastIndexOf('</think>');
  if (closing !== -1) text = text.slice(closing + '</think>'.length);
  const opening = text.toLowerCase().indexOf('<think>');
  if (opening !== -1) text = text.slice(0, opening);
  return text.trim();
}
