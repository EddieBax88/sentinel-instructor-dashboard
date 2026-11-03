import test from 'node:test';
import assert from 'node:assert/strict';
import { latestClassName } from './latestClassName.js';

test('picks the class of the newest order, whatever the ledger order', () => {
  assert.equal(latestClassName([
    { studentName: 'Spring class', createdAt: '2026-10-28T18:00:00Z' },
    { studentName: 'Fall class', createdAt: '2026-10-29T18:00:00Z' },
    { studentName: 'Summer class', createdAt: '2026-10-27T18:00:00Z' },
  ]), 'Fall class');
});

test('is empty with no orders, and skips blank names and email addresses', () => {
  assert.equal(latestClassName([]), '');
  assert.equal(latestClassName(), '');
  assert.equal(latestClassName([
    { studentName: 'Spring class', createdAt: '2026-10-28T18:00:00Z' },
    { studentName: 'instructor@example.test', createdAt: '2026-10-30T18:00:00Z' },
    { studentName: '   ', createdAt: '2026-10-31T18:00:00Z' },
  ]), 'Spring class');
  assert.equal(latestClassName([{ studentName: 'instructor@example.test', createdAt: '2026-10-30T18:00:00Z' }]), '');
});
