import { enableStudioDevValidations } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useEffect, useMemo, useState } from 'react';
import { initialReport } from '../analytics/initialReport.js';
import { buildStudioData } from '../analytics/studioData.js';
import { instructorStudioTheme } from '../analytics/theme.js';
import { studioWidgets } from '../analytics/widgets.jsx';

if (import.meta.env.DEV) enableStudioDevValidations();

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

// Instructor analytics: an AG Studio report over the signed-in instructor's own orders. The
// server decides whose orders these are from the access token; nothing here picks a user.
export default function InstructorAnalytics({ accessToken }) {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('view');

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
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      {!error && !data && <div className="grid-empty">Loading your orders…</div>}
      {data && (
        <div className="analytics-canvas">
          <AgStudioProvider>
            <AgStudio
              style={{ height: '100%', width: '100%' }}
              theme={instructorStudioTheme}
              layout={{ widgetBorderEnabled: true }}
              data={data}
              context={context}
              widgets={studioWidgets}
              initialState={initialReport}
              mode={mode}
            />
          </AgStudioProvider>
        </div>
      )}
    </section>
  );
}
