import { Bot, Check, X } from 'lucide-react';
import { useState } from 'react';

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

export default function AgentPanel({ authHeaders, available }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
        body: JSON.stringify({ messages: nextMessages.slice(-20) }),
      }));
      setMessages([...nextMessages, { role: 'assistant', content: result.reply }]);
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

  return (
    <section className="agent-panel" aria-label="Seat assistant">
      <div className="agent-heading"><Bot size={16} /><strong>Seat assistant</strong><span>Ask in plain English, e.g. "Buy 12 seats for my fall class."</span></div>
      {messages.length > 0 && (
        <ol className="agent-log">
          {messages.map((message, index) => <li key={index} className={`agent-message ${message.role}`}>{message.content}</li>)}
        </ol>
      )}
      {proposal && (
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
        <input id="agent-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={available ? 'Buy 12 seats for my fall class' : 'Add ANTHROPIC_API_KEY to .env'} maxLength="2000" disabled={!available || busy} />
        <button className="checkout-button" type="submit" disabled={!available || busy || !draft.trim()}>{busy ? 'Working…' : 'Send'}</button>
      </form>
    </section>
  );
}
