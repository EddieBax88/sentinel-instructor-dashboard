// The seat assistant's availability has three states. Until the first /api/dashboard answer (and,
// when signed in, the first /api/ledger answer) arrives it is 'loading', which must look like the
// normal assistant with the input disabled. Only a server answer of agentAvailable: false is
// 'unavailable', the one state that shows the missing-key message.
export const AGENT_PLACEHOLDER = 'Buy 12 seats for my fall class';
export const AGENT_KEY_MISSING = 'Add ANTHROPIC_API_KEY to .env';
export const LOADING_TEXT = 'Loading…';

export function agentAvailability({ loaded, agentAvailable }) {
  if (!loaded) return 'loading';
  return agentAvailable ? 'available' : 'unavailable';
}

export function agentPlaceholder(availability) {
  return availability === 'unavailable' ? AGENT_KEY_MISSING : AGENT_PLACEHOLDER;
}

// The dashboard is loaded once a refresh has finished for the current access token (a sign-in or
// sign-out starts a new load, so the previous user's empty ledger never shows as this user's).
export function dashboardLoaded(dashboard, accessToken) {
  return Boolean(dashboard.loaded) && dashboard.loadedFor === (accessToken || null);
}
