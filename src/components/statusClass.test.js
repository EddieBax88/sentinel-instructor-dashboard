import test from 'node:test';
import assert from 'node:assert/strict';
import { statusClass } from './statusClass.js';

test('maps ledger statuses and readiness labels to the three status classes', () => {
  assert.equal(statusClass('COMPLETED'), 'status-completed');
  assert.equal(statusClass('Seat unlocked'), 'status-completed');
  assert.equal(statusClass('REFUNDED'), 'status-refunded');
  assert.equal(statusClass('Seat revoked'), 'status-refunded');
  assert.equal(statusClass('AWAITING PAYMENT'), 'status-pending');
  assert.equal(statusClass('Payment pending'), 'status-pending');
});
