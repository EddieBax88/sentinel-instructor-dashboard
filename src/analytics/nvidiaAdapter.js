// AG Studio LLM adapter for NVIDIA's OpenAI-compatible Chat Completions API. It runs in the
// browser and posts each turn to this app's sign-in-only proxy (server/studioAi.js), which adds
// the NVIDIA key, picks the model, and strips reasoning text. No key ever reaches the browser.
// Pure encode/decode functions are exported for tests and for scripts/probe-studio-agent.mjs.

const textOf = (content) => (Array.isArray(content) ? content : [])
  .map((part) => (part.type === 'text' || part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : ''))
  .filter(Boolean)
  .join('\n');

const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 12)}`;

// Inlines `$ref`s to non-recursive `$defs` entries; recursive definitions stay referenced.
export function inlineSchemaRefs(schema) {
  const defs = schema?.$defs;
  if (!defs) return schema;
  const refName = (ref) => (typeof ref === 'string' && ref.startsWith('#/$defs/') ? ref.slice(8) : null);
  const refsIn = (node, found = new Set()) => {
    if (Array.isArray(node)) node.forEach((child) => refsIn(child, found));
    else if (node && typeof node === 'object') {
      const name = refName(node.$ref);
      if (name) found.add(name);
      Object.values(node).forEach((child) => refsIn(child, found));
    }
    return found;
  };
  const graph = Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, refsIn(def)]));
  const recursive = new Set(Object.keys(graph).filter((start) => {
    const stack = [...graph[start]];
    const seen = new Set();
    while (stack.length) {
      const name = stack.pop();
      if (name === start) return true;
      if (seen.has(name)) continue;
      seen.add(name);
      stack.push(...(graph[name] ?? []));
    }
    return false;
  }));
  const inline = (node) => {
    if (Array.isArray(node)) return node.map(inline);
    if (!node || typeof node !== 'object') return node;
    const name = refName(node.$ref);
    if (name && defs[name] && !recursive.has(name)) {
      const { $ref, ...rest } = node;
      return { ...inline(defs[name]), ...rest };
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs').map(([key, value]) => [key, inline(value)]));
  };
  const result = inline(schema);
  const kept = Object.fromEntries([...recursive].map((name) => [name, inline(defs[name])]));
  return Object.keys(kept).length ? { ...result, $defs: kept } : result;
}

// Studio turn request -> Chat Completions fields (model and generation settings are the proxy's).
export function encodeRequest(request, { inlineRefs = false } = {}) {
  const messages = [];
  if (request.instructions) messages.push({ role: 'system', content: request.instructions });

  for (const item of request.input ?? []) {
    if (item.kind === 'input' && item.type === 'message') {
      messages.push({ role: item.role === 'user' ? 'user' : 'system', content: textOf(item.content) });
    } else if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.callId, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) });
    } else if (item.kind === 'output' && item.type === 'message') {
      messages.push({ role: 'assistant', content: textOf(item.content) });
    } else if (item.kind === 'output' && item.type === 'function_call') {
      const call = { id: item.callId, type: 'function', function: { name: item.name, arguments: item.arguments || '{}' } };
      const last = messages.at(-1);
      // Consecutive calls (and a call right after the assistant's text) belong to one assistant turn.
      if (last?.role === 'assistant') last.tool_calls = [...(last.tool_calls ?? []), call];
      else messages.push({ role: 'assistant', content: '', tool_calls: [call] });
    }
    // Reasoning items are not replayed.
  }

  const tools = (request.tools ?? [])
    .filter((tool) => tool.kind !== 'provided')
    .map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: inlineRefs ? inlineSchemaRefs(tool.parameters) : tool.parameters },
    }));

  const choice = request.toolChoice;
  const body = { messages, ...(tools.length && { tools }) };
  if (choice) body.tool_choice = typeof choice === 'string' ? choice : { type: 'function', function: { name: choice.name } };
  if (request.responseFormat?.type === 'json_schema' || request.responseFormat?.type === 'json') {
    body.response_format = { type: 'json_schema', json_schema: { name: request.responseFormat.name ?? 'response', schema: request.responseFormat.schema } };
  }
  return body;
}

// Proxy reply ({ id, model, message, finish_reason, usage }) -> Studio events and final response.
export function decodeCompletion(payload) {
  const message = payload?.message ?? {};
  const events = [];
  const output = [];

  const text = typeof message.content === 'string' ? message.content.trim() : '';
  if (text) {
    const messageId = newId('msg');
    events.push(
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text },
      { type: 'TEXT_MESSAGE_END', messageId },
    );
    output.push({ id: messageId, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });
  }

  for (const call of message.tool_calls ?? []) {
    if (call?.type && call.type !== 'function') continue;
    const callId = call.id || newId('call');
    const args = call.function?.arguments || '{}';
    events.push(
      { type: 'TOOL_CALL_START', toolCallId: callId, toolCallName: call.function?.name },
      { type: 'TOOL_CALL_ARGS', toolCallId: callId, delta: args },
      { type: 'TOOL_CALL_END', toolCallId: callId },
    );
    output.push({ id: callId, kind: 'output', type: 'function_call', callId, name: call.function?.name, arguments: args, status: 'completed' });
  }

  const truncated = payload?.finish_reason === 'length';
  const usage = payload?.usage;
  return {
    events,
    response: {
      id: payload?.id ?? newId('resp'),
      model: payload?.model,
      status: truncated ? 'incomplete' : 'completed',
      ...(truncated && { incompleteDetails: { reason: 'max_output_tokens' } }),
      output,
      ...(usage && { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens } }),
    },
  };
}

// The AgLlmAdapter Studio calls once per turn. getAccessToken returns the signed-in session token.
// onBusyChange(true/false) reports whether any turn is waiting on the proxy, for a progress display.
export function nvidiaStudioAdapter({ endpoint = '/api/studio-ai/chat', getAccessToken, fetchImpl = (...args) => fetch(...args), onBusyChange = () => {} }) {
  let pending = 0;
  const track = (delta) => {
    const wasBusy = pending > 0;
    pending += delta;
    if (wasBusy !== pending > 0) onBusyChange(pending > 0);
  };
  return {
    executeTurn(request, options = {}) {
      track(1);
      const result = (async () => {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` },
          body: JSON.stringify(encodeRequest(request)),
          signal: options.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `The analytics assistant request failed (${response.status}).`);
        return decodeCompletion(payload);
      })().finally(() => track(-1));
      const complete = result.then(({ response }) => response);
      // A failed turn is reported once, through `complete`; this marks it observed for a reader
      // that stops consuming the stream.
      complete.catch(() => {});
      async function* stream() {
        let decoded;
        try {
          decoded = await result;
        } catch {
          return;
        }
        yield* decoded.events;
      }
      return { stream: { [Symbol.asyncIterator]: () => stream() }, complete };
    },
  };
}
