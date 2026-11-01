// The Seat agent: a custom AG Studio agent that the lead agent hands seat requests to. It runs its
// own code rather than a model loop: it sends the lead's instruction to this app's seat assistant
// (POST /api/agent/chat, server/agent.js, sign-in only), shows the reply in the chat, passes any
// proposal to onProposal for the Confirm bar, and reports back to the lead through complete_task.
// It never orders or pays: the instructor confirms on the dashboard, through the existing
// confirm endpoint, before PayPal is involved.

export const SEAT_AGENT_ID = 'seat';

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join('\n');
};

// What the lead receives from the delegation: the assistant's reply, plus a reminder that nothing
// has been ordered when a proposal is waiting for Confirm.
export function seatSummary(reply, proposal) {
  return proposal
    ? `${reply} The proposal is waiting for the instructor to click Confirm above the report; nothing has been ordered or paid.`
    : reply;
}

export function createSeatAgent({ getAccessToken, onProposal = () => {}, endpoint = '/api/agent/chat', fetchImpl = (...args) => fetch(...args) }) {
  return {
    id: SEAT_AGENT_ID,
    name: 'Seat agent',
    description: 'Prices class seats, reports seat availability and the instructor\'s seat orders, and prepares a seat order for the instructor to confirm. Use it for any request to buy, order or price seats. It never places or pays for an order.',
    // A custom run: Studio adds no turn loop, so the run brackets and complete_task are emitted here.
    async* run(input, ctx) {
      const { threadId, runId } = input;
      yield { type: 'RUN_STARTED', threadId, runId };

      const request = [...(input.messages ?? [])].reverse().find((message) => message.role === 'user');
      let reply;
      let proposal = null;
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` },
          body: JSON.stringify({ messages: [{ role: 'user', content: textOf(request?.content) }] }),
          signal: ctx?.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `The seat assistant request failed (${response.status}).`);
        reply = typeof payload.reply === 'string' ? payload.reply : '';
        proposal = payload.proposal ?? null;
      } catch (error) {
        if (ctx?.signal?.aborted) return;
        reply = `The seat assistant could not prepare an order: ${error.message}`;
      }
      if (proposal) onProposal(proposal);

      const messageId = `msg-${runId}`;
      yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: reply };
      yield { type: 'TEXT_MESSAGE_END', messageId };

      // Only a delegated run has complete_task. Studio reads the lead's summary from this call's
      // stored result, so TOOL_CALL_RESULT is required, not just the call events.
      if (ctx?.completeTask) {
        const toolCallId = `complete-${runId}`;
        const summary = seatSummary(reply, proposal);
        const artifacts = proposal
          ? [{ id: String(proposal.id), type: 'seat-proposal', description: `${proposal.quantity} seats for ${proposal.className}, ${proposal.currency} ${proposal.total}, awaiting Confirm` }]
          : [];
        yield { type: 'TOOL_CALL_START', toolCallId, toolCallName: ctx.completeTask.name ?? 'complete_task' };
        yield { type: 'TOOL_CALL_ARGS', toolCallId, delta: JSON.stringify({ summary, artifacts }) };
        yield { type: 'TOOL_CALL_END', toolCallId };
        yield { type: 'TOOL_CALL_RESULT', messageId: `${toolCallId}-result`, toolCallId, content: JSON.stringify({ success: true, response: summary, data: { summary, artifacts } }) };
      }

      yield { type: 'RUN_FINISHED', threadId, runId };
    },
  };
}
