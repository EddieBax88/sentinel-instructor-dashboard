// The real Instructor analytics view with Ask AI and the Seat agent on, for e2e/seatAgent.test.mjs.
// Signed in as the test instructor; the test's server answers every /api route except the lead's
// model turns.
import React from 'react';
import { createRoot } from 'react-dom/client';
import InstructorAnalytics from '../../src/components/InstructorAnalytics.jsx';
import '../../src/styles.css';

createRoot(document.getElementById('root')).render(
  <InstructorAnalytics accessToken="instructor-token" assistantAvailable seatAgentAvailable />,
);
