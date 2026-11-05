import { Bot, Check, ChevronRight, X } from 'lucide-react';
import { useRef, useState } from 'react';
import PromptChips from './PromptChips.jsx';
import RefundConfirmBar, { refundIssuedMessage } from './RefundConfirmBar.jsx';
import { agentPlaceholder } from './agentAvailability.js';

// Renders **bold** spans as <strong>; React escapes the text, and stray asterisks are dropped.
function formatReply(text) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => (
    /^\*\*[^*\n]+\*\*$/.test(part)
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.replaceAll('**', '')
  ));
}

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

// "AI trace": the tool calls the model made for this reply, as the server ran them. Collapsed by
// default; each step shows the tool name, the model's arguments and the server's result.
function AiTrace({ trace }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="agent-trace">
      <button type="button" className="agent-trace-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={12} aria-hidden="true" />AI trace · {trace.length} {trace.length === 1 ? 'step' : 'steps'}
      </button>
      {open && (
        <ol className="agent-trace-steps" aria-label="AI trace">
          {trace.map((step, index) => (
            <li key={index} className={step.ok ? 'agent-trace-step' : 'agent-trace-step error'}>
              <code className="agent-trace-tool">{index + 1}. {step.tool}</code>
              <span className="agent-trace-label">Arguments</span>
              <pre>{JSON.stringify(step.arguments ?? null, null, 2)}</pre>
              <span className="agent-trace-label">Server result</span>
              <pre>{JSON.stringify(step.result ?? null, null, 2)}</pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Judge prompts. Each one works end to end: the purchase chips go through the seat agent to a
// Confirm bar and PayPal Sandbox. The refund chip appears only when the server offers refunds.
export const SEAT_CHIPS = ['Buy 12 seats for my fall class', 'Buy 3 seats for the spring class'];
export const REFUND_CHIP = 'Refund my last seat order';

// availability: 'loading' | 'available' | 'unavailable' (see agentAvailability.js).
export default function AgentPanel({ authHeaders, availability, refundAvailable = false }) {
  const available = availability === 'available';
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function pickChip(prompt) {
    setDraft(prompt);
    inputRef.current?.focus();
  }

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setDraft('');
    setProposal(null);
    setError('');
    setBusy(true);
    try {
      const result = await readResponse(await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ messages: nextMessages.slice(-20).map(({ role, content }) => ({ role, content })) }),
      }));
      setMessages([...nextMessages, { role: 'assistant', content: result.reply, trace: Array.isArray(result.trace) ? result.trace : [] }]);
      setProposal(result.proposal);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const order = await readResponse(await fetch(`/api/agent/proposals/${encodeURIComponent(proposal.id)}/confirm`, {
        method: 'POST',
        headers: authHeaders(),
      }));
      window.location.assign(order.approvalUrl);
    } catch (requestError) {
      setError(requestError.message);
      setProposal(null);
      setBusy(false);
    }
  }

  function refundIssued(result) {
    setProposal(null);
    setMessages((current) => [...current, { role: 'assistant', content: refundIssuedMessage(result) }]);
  }

  return (
    <section className="agent-panel" aria-label="Seat assistant">
      <div className="agent-heading"><Bot size={16} /><strong>Seat assistant</strong><span>Ask in plain English, e.g. "Buy 12 seats for my fall class."</span></div>
      {messages.length > 0 && (
        <ol className="agent-log">
          {messages.map((message, index) => (
            <li key={index} className={`agent-message ${message.role}`}>
              {message.role === 'assistant' ? formatReply(message.content) : message.content}
              {message.trace?.length > 0 && <AiTrace trace={message.trace} />}
            </li>
          ))}
        </ol>
      )}
      {proposal?.type === 'refund' && (
        <RefundConfirmBar key={proposal.captureId} proposal={proposal} authHeaders={authHeaders} onIssued={refundIssued} onDismiss={() => setProposal(null)} />
      )}
      {proposal && proposal.type !== 'refund' && (
        <div className="agent-proposal" role="group" aria-label="Seat order awaiting confirmation">
          <span>{proposal.quantity} seats · {proposal.currency} {proposal.unitPrice} each · <strong>{proposal.currency} {proposal.total} total</strong> · {proposal.className}</span>
          <div>
            <button className="checkout-button" type="button" onClick={confirm} disabled={busy}><Check size={14} />Confirm</button>
            <button className="agent-cancel" type="button" onClick={() => setProposal(null)} disabled={busy}><X size={14} />Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="notice" role="alert">{error}</p>}
      <form className="checkout-form" onSubmit={send}>
        <label className="sr-only" htmlFor="agent-input">Message the seat assistant</label>
        <input id="agent-input" ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={agentPlaceholder(availability)} maxLength="2000" disabled={!available || busy} />
        <button className="checkout-button" type="submit" disabled={!available || busy || !draft.trim()}>{busy ? 'Working…' : 'Send'}</button>
      </form>
      {available && <PromptChips prompts={refundAvailable ? [...SEAT_CHIPS, REFUND_CHIP] : SEAT_CHIPS} onPick={pickChip} label="Example seat requests" />}
    </section>
  );
}
