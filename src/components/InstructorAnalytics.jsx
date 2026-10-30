import { AgStudioAiModule, createAiHarness, enableStudioDevValidations } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { nvidiaStudioAdapter } from '../analytics/nvidiaAdapter.js';
import { initialReport } from '../analytics/initialReport.js';
import { buildStudioData } from '../analytics/studioData.js';
import { instructorStudioTheme } from '../analytics/theme.js';
import { studioWidgets } from '../analytics/widgets.jsx';

if (import.meta.env.DEV) enableStudioDevValidations();

// Shown in a new analytics chat before anything is typed.
const PROMPT_STARTERS = [
  { label: 'Show revenue by class', prompt: 'Add a column chart of revenue by class.' },
  { label: 'Seats pending by day', prompt: 'Add a chart of seats pending by order date (day).' },
  { label: 'Unpaid seats by class', prompt: 'Which class has the most seats still awaiting payment? Answer, then add a grid of seats pending and awaiting payment by class.' },
];

// "Ask AI" is edit mode with only the AI panel: Studio shows its assistant in edit mode only.
const PANELS = {
  view: undefined,
  edit: undefined,
  ask: { edit: { right: ['ai'] } },
};

// Studio runs a tool in the browser between proxy turns; the progress bar stays up through
// that short gap instead of flickering off and on.
const IDLE_GRACE_MS = 1500;

// Visible while the assistant works: a question takes several model turns, often 10 to 25 seconds.
function useAssistantProgress() {
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const idleTimer = useRef(null);
  const onBusyChange = useRef((busy) => {
    clearTimeout(idleTimer.current);
    if (busy) setStartedAt((started) => started ?? Date.now());
    else idleTimer.current = setTimeout(() => setStartedAt(null), IDLE_GRACE_MS);
  }).current;

  useEffect(() => () => clearTimeout(idleTimer.current), []);
  useEffect(() => {
    if (startedAt === null) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const seconds = startedAt === null ? null : Math.max(0, Math.round((now - startedAt) / 1000));
  return { onBusyChange, seconds };
}

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

// Instructor analytics: an AG Studio report over the signed-in instructor's own orders. The
// server decides whose orders these are from the access token; nothing here picks a user.
export default function InstructorAnalytics({ accessToken, assistantAvailable }) {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('view');
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const { onBusyChange, seconds } = useAssistantProgress();

  // Studio's agents can only read this report's data and build widgets; every turn goes through
  // the sign-in-only proxy, which holds the NVIDIA key and refuses any non-Studio tool.
  const ai = useMemo(() => (assistantAvailable
    ? ({ api }) => createAiHarness(api, {
      adapter: nvidiaStudioAdapter({ getAccessToken: () => tokenRef.current, onBusyChange }),
      promptStarters: PROMPT_STARTERS,
    })
    : undefined), [assistantAvailable, onBusyChange]);

  useEffect(() => {
    let active = true;
    setError('');
    fetch('/api/analytics/orders', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(readResponse)
      .then((data) => active && setAnalytics(data))
      .catch((requestError) => active && setError(requestError.message));
    return () => { active = false; };
  }, [accessToken]);

  const data = useMemo(() => analytics && buildStudioData(analytics.orders), [analytics]);
  const context = useMemo(() => ({ classSize: analytics?.classSize ?? 0 }), [analytics]);

  return (
    <section id="analytics" className="analytics-section">
      <div className="section-title">
        <div><p className="eyebrow">YOUR ORDERS ONLY</p><h2>Instructor analytics</h2></div>
        <div className="analytics-modes" role="group" aria-label="Report mode">
          <button type="button" className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>View</button>
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit layout</button>
          <button type="button" className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')} disabled={!assistantAvailable} title={assistantAvailable ? 'Ask the analytics assistant' : 'Add NVIDIA_API_KEY to .env to enable the assistant'}>Ask AI</button>
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="ai-progress" role="status" aria-live="polite" hidden={seconds === null}>
        {seconds !== null && (
          <>
            <span className="ai-progress-spinner" aria-hidden="true" />
            <strong>Analytics assistant is working… {seconds}s</strong>
            <span>Questions can take 10 to 25 seconds.</span>
          </>
        )}
      </div>
      {!error && !data && <div className="grid-empty">Loading your orders…</div>}
      {data && (
        <div className="analytics-canvas">
          <AgStudioProvider modules={ai ? [AgStudioAiModule] : undefined}>
            <AgStudio
              style={{ height: '100%', width: '100%' }}
              theme={instructorStudioTheme}
              layout={{ widgetBorderEnabled: true }}
              data={data}
              context={context}
              widgets={studioWidgets}
              initialState={initialReport}
              mode={mode === 'view' ? 'view' : 'edit'}
              panels={PANELS[mode]}
              ai={ai}
            />
          </AgStudioProvider>
        </div>
      )}
    </section>
  );
}
