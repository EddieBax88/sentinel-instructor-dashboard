import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardFromOrders,
  getDashboardState,
  recordPendingOrder,
  resetSeatState,
  unlockSeatsFromVerifiedCapture,
} from './seatUnlock.js';
import { DEFAULT_CLASS_SIZE } from './config.js';

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
test('counts multi-seat orders by quantity with no class-size cap', () => {
  recordPendingOrder({ orderId: 'ORDER-1', userId: 'USER-1', studentName: 'Fall class', quantity: 10, cohortId: 'cohort', amount: '490.00', currency: 'USD' });
  recordPendingOrder({ orderId: 'ORDER-2', userId: 'USER-2', studentName: 'Spring class', quantity: 25, cohortId: 'cohort', amount: '1225.00', currency: 'USD' });
  const quota = getDashboardState().quotas[0];
  assert.equal(quota.classSize, DEFAULT_CLASS_SIZE);
  assert.equal(quota.seatsReserved, 35);
  assert.equal(quota.seatsRemaining, 0);

  unlockSeatsFromVerifiedCapture({
    orderId: 'ORDER-2', captureId: 'CAP-2', status: 'COMPLETED', amount: '1225.00', currency: 'USD', source: 'test',
  });
  assert.equal(getDashboardState().quotas[0].seatsSold, 25);
  assert.equal(getDashboardState().quotas[0].seatsReserved, 10);
});

test('builds the ledger from Supabase rows so a server restart cannot hide orders', () => {
  // The live bug: the order existed in Supabase but the dashboard read an empty in-memory ledger.
  recordPendingOrder({ orderId: 'ORDER-MEM', userId: 'USER-1', studentName: 'Old', cohortId: 'cohort', amount: '49.00', currency: 'USD' });
  resetSeatState();

  const ledger = dashboardFromOrders([
    { paypal_order_id: 'ORDER-30', student_name: 'Fall class', quantity: 30, amount: 1470, currency: 'USD', status: 'PENDING', created_at: '2026-10-28T18:00:00Z', paypal_payments: [] },
    { paypal_order_id: 'ORDER-2', student_name: 'Spring class', quantity: 2, amount: '98.00', currency: 'USD', status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-2', created_at: '2026-10-27T18:05:00Z' }] },
  ]);

  assert.equal(ledger.transactions.length, 2);
  assert.deepEqual(ledger.transactions[0], {
    orderId: 'ORDER-30', studentName: 'Fall class', cohortId: 'sentinel-fall-2026', quantity: 30, amount: '1470.00', currency: 'USD',
    captureId: '', status: 'AWAITING PAYMENT', createdAt: '2026-10-28T18:00:00Z', unlockedAt: undefined,
  });
  assert.equal(ledger.transactions[1].captureId, 'CAP-2');
  assert.equal(ledger.quotas[0].seatsReserved, 30);
  assert.equal(ledger.quotas[0].seatsSold, 2);
  assert.equal(ledger.quotas[0].seatsRemaining, 0);
  assert.deepEqual(ledger.students.map((student) => student.readiness), ['Payment pending', 'Seat unlocked']);
  assert.equal(getDashboardState().transactions.length, 0);
});

test('an instructor with no orders gets an empty ledger', () => {
  const ledger = dashboardFromOrders([]);
  assert.equal(ledger.transactions.length, 0);
  assert.equal(ledger.quotas[0].seatsReserved, 0);
  assert.equal(ledger.quotas[0].seatsRemaining, DEFAULT_CLASS_SIZE);
});
