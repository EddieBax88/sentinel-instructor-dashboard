import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDashboardState,
  recordPendingOrder,
  resetSeatState,
  unlockSeatsFromVerifiedCapture,
} from './seatUnlock.js';

test.beforeEach(resetSeatState);

test('does not unlock a seat before a completed matching capture', () => {
  recordPendingOrder({ orderId: 'ORDER-1', userId: 'USER-1', studentName: 'Avery', cohortId: 'cohort', amount: '49.00', currency: 'USD' });
  assert.throws(() => unlockSeatsFromVerifiedCapture({
    orderId: 'ORDER-1', captureId: 'CAP-1', status: 'PENDING', amount: '49.00', currency: 'USD', source: 'test',
  }), /completed PayPal capture/);
  assert.equal(getDashboardState().quotas[0].seatsSold, 0);
});

test('unlocks exactly one seat and is idempotent for duplicate verified events', () => {
  recordPendingOrder({ orderId: 'ORDER-1', userId: 'USER-1', studentName: 'Avery', cohortId: 'cohort', amount: '49.00', currency: 'USD' });
  const capture = { orderId: 'ORDER-1', captureId: 'CAP-1', status: 'COMPLETED', amount: '49.00', currency: 'USD', source: 'test' };
  const first = unlockSeatsFromVerifiedCapture(capture);
  const duplicate = unlockSeatsFromVerifiedCapture({ ...capture, source: 'verified-webhook' });
  assert.equal(first.captureId, duplicate.captureId);
  assert.equal(getDashboardState().quotas[0].seatsSold, 1);
  assert.equal(getDashboardState().students[0].readiness, 'Seat unlocked');
});

test('rejects captures whose amount differs from the fixed seat price', () => {
  recordPendingOrder({ orderId: 'ORDER-1', userId: 'USER-1', studentName: 'Avery', cohortId: 'cohort', amount: '49.00', currency: 'USD' });
  assert.throws(() => unlockSeatsFromVerifiedCapture({
    orderId: 'ORDER-1', captureId: 'CAP-1', status: 'COMPLETED', amount: '1.00', currency: 'USD', source: 'test',
  }), /amount or currency/);
});

test('returns a sortable live ledger containing both pending and completed orders', () => {
  recordPendingOrder({ orderId: 'ORDER-1', userId: 'USER-1', studentName: 'Avery', cohortId: 'cohort', amount: '49.00', currency: 'USD' });
  unlockSeatsFromVerifiedCapture({
    orderId: 'ORDER-1', captureId: 'CAP-1', status: 'COMPLETED', amount: '49.00', currency: 'USD', source: 'test',
  });
  recordPendingOrder({ orderId: 'ORDER-2', userId: 'USER-2', studentName: 'Riley', cohortId: 'cohort', amount: '49.00', currency: 'USD' });
  const dashboard = getDashboardState();
  assert.equal(dashboard.transactions.length, 2);
  assert.equal(dashboard.transactions[0].status, 'AWAITING PAYMENT');
  assert.equal(dashboard.transactions[1].status, 'COMPLETED');
});