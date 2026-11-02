import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardFromOrders, ledgerStatus, money, seatsRemaining } from './seatUnlock.js';
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
  assert.equal(ledger.quotas[0].seatsRemaining, DEFAULT_CLASS_SIZE - 2);
  assert.deepEqual(ledger.students.map((student) => student.readiness), ['Payment pending', 'Seat unlocked']);
});

test('pending orders are reported on their own and never reduce the seats remaining (the "0 / 30" bug)', () => {
  // Reproduces the live state: 7 unlocked, a 30-seat order awaiting payment, class size 30.
  const ledger = dashboardFromOrders([
    { paypal_order_id: 'ORDER-7', student_name: 'Fall class', quantity: 7, amount: 343, currency: 'USD', status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-7', created_at: '2026-10-27T18:05:00Z' }] },
    { paypal_order_id: 'ORDER-30', student_name: 'Spring class', quantity: 30, amount: 1470, currency: 'USD', status: 'PENDING', created_at: '2026-10-28T18:00:00Z', paypal_payments: [] },
    { paypal_order_id: 'ORDER-A', student_name: 'Spring class', quantity: 3, amount: 147, currency: 'USD', status: 'APPROVED', created_at: '2026-10-29T18:00:00Z', paypal_payments: [] },
  ]);
  const [quota] = ledger.quotas;
  assert.equal(quota.classSize, 30);
  assert.deepEqual([quota.seatsSold, quota.seatsReserved, quota.seatsRefunded, quota.seatsRemaining], [7, 33, 0, 23]);
});

test('unlocked seats fill the class; remaining is class size less unlocked and never negative', () => {
  const ledger = dashboardFromOrders([
    { paypal_order_id: 'ORDER-30', student_name: 'Fall class', quantity: 30, amount: 1470, currency: 'USD', status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-30', created_at: '2026-10-27T18:05:00Z' }] },
    { paypal_order_id: 'ORDER-5', student_name: 'Fall class', quantity: 5, amount: 245, currency: 'USD', status: 'COMPLETED', created_at: '2026-10-28T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-5', created_at: '2026-10-28T18:05:00Z' }] },
  ]);
  assert.deepEqual([ledger.quotas[0].seatsSold, ledger.quotas[0].seatsRemaining], [35, 0]);
  assert.equal(seatsRemaining(30, 7), 23);
  assert.equal(seatsRemaining(30, 30), 0);
  assert.equal(seatsRemaining(30, 31), 0);
});

test('refunded seats return to the seats remaining', () => {
  const before = dashboardFromOrders([
    { paypal_order_id: 'ORDER-12', student_name: 'Fall class', quantity: 12, amount: 588, currency: 'USD', status: 'COMPLETED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-12', created_at: '2026-10-27T18:05:00Z' }] },
  ]);
  const after = dashboardFromOrders([
    { paypal_order_id: 'ORDER-12', student_name: 'Fall class', quantity: 12, amount: 588, currency: 'USD', status: 'REFUNDED', created_at: '2026-10-27T18:00:00Z', paypal_payments: [{ capture_id: 'CAP-12', created_at: '2026-10-27T18:05:00Z' }] },
  ]);
  assert.deepEqual([before.quotas[0].seatsSold, before.quotas[0].seatsRemaining], [12, 18]);
  assert.deepEqual([after.quotas[0].seatsSold, after.quotas[0].seatsRefunded, after.quotas[0].seatsRemaining], [0, 12, 30]);
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
