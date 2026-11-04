import test from 'node:test';
import assert from 'node:assert/strict';
import { seatProgressModel } from './seatProgress.js';

test('pending seats do not reduce the seats remaining (the "0 / 30" bug)', () => {
  const model = seatProgressModel({ classSize: 30, unlocked: 7, pending: 30 });
  assert.equal(model.remaining, 23);
  assert.equal(model.pending, 30);
  assert.equal(model.unlockedWidth, `${(7 / 37) * 100}%`);
  assert.equal(model.label, '7 seats unlocked, 30 awaiting payment, 23 of 30 remaining');
});

test('unlocked seats fill the class and remaining never goes below zero', () => {
  assert.equal(seatProgressModel({ classSize: 30, unlocked: 30, pending: 0 }).remaining, 0);
  assert.equal(seatProgressModel({ classSize: 30, unlocked: 42, pending: 0 }).remaining, 0);
  assert.equal(seatProgressModel({ classSize: 30, unlocked: 0, pending: 0 }).remaining, 30);
});

test('missing or non-numeric values count as zero', () => {
  const model = seatProgressModel({ classSize: undefined, unlocked: 'x', pending: null });
  assert.deepEqual([model.classSize, model.unlocked, model.pending, model.remaining, model.unlockedWidth], [0, 0, 0, 0, '0%']);
});
