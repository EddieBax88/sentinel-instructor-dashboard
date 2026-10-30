// The real Instructor analytics view, for scripts/time-ask-ai.mjs. The script answers
// /api/analytics/orders with sample orders and /api/studio-ai/chat through the proxy's request
// builder, so no sign-in or app server is needed.
import React from 'react';
import { createRoot } from 'react-dom/client';
import InstructorAnalytics from '../../src/components/InstructorAnalytics.jsx';
import '../../src/styles.css';

createRoot(document.getElementById('root')).render(<InstructorAnalytics accessToken="timing-harness" assistantAvailable />);
