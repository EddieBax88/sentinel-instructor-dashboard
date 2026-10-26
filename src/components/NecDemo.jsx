import { ArrowRight, RotateCcw } from 'lucide-react';
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
  return (
    <div className="nec-demo">
      <div className="nec-flow" aria-label="Five-step sample lookup">
        {lookup.map((step, index) => (
          <button className={`nec-step${index === activeStep ? ' selected' : ''}${index < activeStep ? ' visited' : ''}`} key={step.label} onClick={() => setActiveStep(index)}>
            <span className="nec-step-top"><span>0{index + 1}</span>{index < lookup.length - 1 && <ArrowRight size={14} />}</span>
            <strong>{step.label}</strong>
            <span className="nec-value">{index <= activeStep ? step.value : 'Continue lookup'}</span>
          </button>
        ))}
      </div>
      <div className="nec-controls"><span>{lookup[activeStep].detail} · illustrative navigation only</span><button onClick={() => setActiveStep(0)} aria-label="Reset lookup"><RotateCcw size={14} />Reset</button></div>
    </div>
  );
}