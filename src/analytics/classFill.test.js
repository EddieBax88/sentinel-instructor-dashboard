import test from 'node:test';
import assert from 'node:assert/strict';
import { classFillRows } from './classFill.js';

const keys = { classKey: 'c', unlockedKey: 'u', classSize: 30 };

test('one row per class, fullest first, with percent of the class size', () => {
  const rows = classFillRows([
    { c: 'Spring class', u: 2 },
    { c: 'Fall class', u: 12 },
    { c: 'Night class', u: 0 },
  ], keys);
  assert.deepEqual(rows.map((row) => [row.className, row.unlocked, row.percent, row.full]), [
    ['Fall class', 12, 40, false],
    ['Spring class', 2, 7, false],
    ['Night class', 0, 0, false],
  ]);
  assert.ok(rows.every((row) => row.classSize === 30));
});

test('a class at or past its size is full and its bar never exceeds 100 percent', () => {
  const rows = classFillRows([{ c: 'Fall class', u: 30 }, { c: 'Big class', u: 45 }], keys);
  assert.deepEqual(rows.map((row) => [row.className, row.percent, row.full]), [['Big class', 100, true], ['Fall class', 100, true]]);
});

test('missing names, non-numeric seats and a missing class size are handled', () => {
  const rows = classFillRows([{ c: null, u: 'x' }, { c: '', u: 3 }], { ...keys, classSize: undefined });
  assert.deepEqual(rows.map((row) => [row.className, row.unlocked, row.percent, row.full, row.classSize]), [
    ['(no class name)', 3, 100, false, 0],
    ['(no class name)', 0, 0, false, 0],
  ]);
});

test('ties on seats sort by class name', () => {
  const rows = classFillRows([{ c: 'B', u: 1 }, { c: 'A', u: 1 }], keys);
  assert.deepEqual(rows.map((row) => row.className), ['A', 'B']);
});
