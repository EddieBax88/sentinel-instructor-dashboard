import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_KEY_MISSING, AGENT_PLACEHOLDER, agentAvailability, agentPlaceholder, dashboardLoaded } from './agentAvailability.js';

test('while config is loading the placeholder is the normal one, never the key message', () => {
  for (const agentAvailable of [false, true, undefined]) {
    const state = agentAvailability({ loaded: false, agentAvailable });
    assert.equal(state, 'loading');
    assert.equal(agentPlaceholder(state), AGENT_PLACEHOLDER);
    assert.notEqual(agentPlaceholder(state), AGENT_KEY_MISSING);
  }
});

test('the key message shows only when the server said the key is missing', () => {
  assert.equal(agentAvailability({ loaded: true, agentAvailable: false }), 'unavailable');
  assert.equal(agentPlaceholder('unavailable'), AGENT_KEY_MISSING);
  assert.equal(agentAvailability({ loaded: true, agentAvailable: true }), 'available');
  assert.equal(agentPlaceholder('available'), AGENT_PLACEHOLDER);
});

test('the dashboard counts as loaded only for the token its last refresh used', () => {
  assert.equal(dashboardLoaded({ loaded: false }, 'tok'), false);
  assert.equal(dashboardLoaded({ loaded: true, loadedFor: null }, 'tok'), false);
  assert.equal(dashboardLoaded({ loaded: true, loadedFor: 'old' }, 'tok'), false);
  assert.equal(dashboardLoaded({ loaded: true, loadedFor: 'tok' }, 'tok'), true);
  assert.equal(dashboardLoaded({ loaded: true, loadedFor: null }, undefined), true);
});
