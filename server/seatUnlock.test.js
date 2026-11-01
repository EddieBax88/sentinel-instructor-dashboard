import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardFromOrders, ledgerStatus, money } from './seatUnlock.js';
import { DEFAULT_CLASS_SIZE } from './config.js';

test('formats stored amounts as two-decimal strings', () => {
  assert.equal(money(1470), '1470.00');
  assert.equal(money('49.5'), '49.50');
});

test('builds the ledger from Supabase rows so a server restart cannot hide orders', () => {
  // The live bug: the order existed in Supabase but the dashboard read an empty in-memory ledger.
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
});

test('a refunded order shows REFUNDED, counts in no seat total but refunded, and the student is marked revoked', () => {
  const ledger = dashboardFromOrders([
    { paypal_order_id: 'ORDER-30', student_name: 'Fall class', quantity: 30, amount: 1470, currency: 'USD', status: 'REFUNDED', created_at: '2026-10-28T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-30', created_at: '2026-10-28T18:05:00Z' }] },
    { paypal_order_id: 'ORDER-2', student_name: 'Spring class', quantity: 2, amount: '98.00', currency: 'USD', status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-2', created_at: '2026-10-27T18:05:00Z' }] },
  ]);
  assert.equal(ledger.transactions[0].status, 'REFUNDED');
  assert.equal(ledger.transactions[0].captureId, 'CAP-30');
  assert.equal(ledger.transactions[0].unlockedAt, undefined);
  assert.deepEqual([ledger.quotas[0].seatsSold, ledger.quotas[0].seatsReserved, ledger.quotas[0].seatsRefunded, ledger.quotas[0].seatsRemaining], [2, 0, 30, 28]);
  assert.deepEqual(ledger.students.map((student) => student.readiness), ['Seat revoked', 'Seat unlocked']);
  assert.deepEqual(['COMPLETED', 'REFUNDED', 'PENDING', undefined].map(ledgerStatus), ['COMPLETED', 'REFUNDED', 'AWAITING PAYMENT', 'AWAITING PAYMENT']);
});

test('an instructor with no orders gets an empty ledger', () => {
  const ledger = dashboardFromOrders([]);
  assert.equal(ledger.transactions.length, 0);
  assert.equal(ledger.quotas[0].seatsReserved, 0);
  assert.equal(ledger.quotas[0].seatsRefunded, 0);
  assert.equal(ledger.quotas[0].seatsRemaining, DEFAULT_CLASS_SIZE);
});
