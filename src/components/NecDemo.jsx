import { ArrowRight, RotateCcw, Bot, CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';

const lookup = [
  { label: 'Keyword', value: 'conductor sizing', detail: 'Search phrase' },
  { label: 'Chapter', value: 'Sample Chapter: Sizing concepts', detail: 'Broad topic' },
  { label: 'Article', value: 'Sample Article: Choosing capacity', detail: 'Focused subject' },
  { label: 'Part', value: 'Sample Part: General guidance', detail: 'Subtopic' },
  { label: 'Section', value: 'Sample Section: Verify load before selection', detail: 'Paraphrased destination' },
];

export default function NecDemo() {
  const [activeStep, setActiveStep] = useState(0);
  const [agentStatus, setAgentStatus] = useState('idle'); // idle | analyzing | approved | error
  const [errorMessage, setErrorMessage] = useState('');

  const handleStepClick = (index) => {
    setActiveStep(index);
    if (index < 4) {
      setAgentStatus('idle');
    }
  };

  const runAgenticCheckout = async () => {
    setAgentStatus('analyzing');
    setErrorMessage('');
    try {
      // Simulate AI Agent validating 5-step compliance before triggering PayPal tool call
      await new Promise((resolve) => setTimeout(resolve, 800));
      
      const response = await fetch('/api/paypal/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: 'AI Agent (NEC Verified Student)' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Agent order execution failed');

      setAgentStatus('approved');
      window.location.href = data.approvalUrl;
    } catch (err) {
      setAgentStatus('error');
      setErrorMessage(err.message);
    }
  };

  return (
    <div className="nec-demo">
      <div className="nec-flow" aria-label="Five-step sample lookup">
        {lookup.map((step, index) => (
          <button 
            className={`nec-step${index === activeStep ? ' selected' : ''}${index < activeStep ? ' visited' : ''}`} 
            key={step.label} 
            onClick={() => handleStepClick(index)}
          >
            <span className="nec-step-top"><span>0{index + 1}</span>{index < lookup.length - 1 && <ArrowRight size={14} />}</span>
            <strong>{step.label}</strong>
            <span className="nec-value">{index <= activeStep ? step.value : 'Continue lookup'}</span>
          </button>
        ))}
      </div>

      <div className="nec-controls">
        <span>{lookup[activeStep].detail} · illustrative navigation only</span>
        <button onClick={() => { setActiveStep(0); setAgentStatus('idle'); }} aria-label="Reset lookup">
          <RotateCcw size={14} />Reset
        </button>
      </div>

      {activeStep === 4 && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Bot size={20} color="#16a34a" />
            <div>
              <strong style={{ display: 'block', color: '#166534', fontSize: '0.95rem' }}>Agentic Commerce Tool Trigger</strong>
              <span style={{ fontSize: '0.85rem', color: '#15803d' }}>5-step compliance lookup verified. AI Agent ready to provision seat.</span>
            </div>
          </div>
          <button
            onClick={runAgenticCheckout}
            disabled={agentStatus === 'analyzing'}
            style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {agentStatus === 'analyzing' && <Loader2 size={16} className="animate-spin" />}
            {agentStatus === 'approved' && <CheckCircle2 size={16} />}
            {agentStatus === 'analyzing' ? 'Agent Executing...' : 'Autonomous AI Checkout ($49)'}
          </button>
        </div>
      )}

      {agentStatus === 'error' && (
        <div style={{ marginTop: '0.75rem', color: '#dc2626', fontSize: '0.85rem' }}>
          Agent Error: {errorMessage}
        </div>
      )}
    </div>
  );
}