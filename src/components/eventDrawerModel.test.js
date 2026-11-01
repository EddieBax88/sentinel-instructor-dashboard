import test from 'node:test';
import assert from 'node:assert/strict';
import { eventLabel, formatAmount, POLL_INTERVAL_MS, startPolling } from './eventDrawerModel.js';

// Timers the test advances by hand.
function manualTimers() {
  const intervals = new Map();
  let next = 1;
  return {
    intervals,
    setInterval: (fn, ms) => {
      intervals.set(next, { fn, ms });
      return next++;
    },
    clearInterval: (id) => intervals.delete(id),
    fire: () => [...intervals.values()].forEach(({ fn }) => fn()),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('polls immediately, then every 5 seconds, and stops completely when closed', async () => {
  const timers = manualTimers();
  const seen = [];
  let loads = 0;
  const stop = startPolling(async () => [`load ${++loads}`], { timers, onEvents: (events) => seen.push(...events) });
  await settle();
  assert.equal(POLL_INTERVAL_MS, 5000);
  assert.deepEqual([...timers.intervals.values()].map(({ ms }) => ms), [5000]);
  assert.deepEqual(seen, ['load 1']);

  timers.fire();
  await settle();
  assert.deepEqual(seen, ['load 1', 'load 2']);

  stop();
  assert.equal(timers.intervals.size, 0);
  timers.fire();
  await settle();
  assert.equal(loads, 2);
});

test('does not start a second load while one is in flight, and reports nothing after close', async () => {
  const timers = manualTimers();
  let release;
  let loads = 0;
  const seen = [];
  const stop = startPolling(() => {
    loads += 1;
    return new Promise((resolve) => { release = resolve; });
  }, { timers, onEvents: (events) => seen.push(events) });
  timers.fire();
  timers.fire();
  assert.equal(loads, 1);
  stop();
  release(['late']);
  await settle();
  assert.deepEqual(seen, []);
});

test('reports load errors and keeps polling', async () => {
  const timers = manualTimers();
  const errors = [];
  let attempt = 0;
  const seen = [];
  const stop = startPolling(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('offline');
    return ['ok'];
  }, { timers, onError: (error) => errors.push(error.message), onEvents: (events) => seen.push(...events) });
  await settle();
  timers.fire();
  await settle();
  stop();
  assert.deepEqual(errors, ['offline']);
  assert.deepEqual(seen, ['ok']);
});

test('labels known PayPal event types and formats amounts', () => {
  assert.equal(eventLabel('PAYMENT.CAPTURE.COMPLETED'), 'Payment captured');
  assert.equal(eventLabel('CHECKOUT.ORDER.APPROVED'), 'Order approved');
  assert.equal(eventLabel('SOMETHING.NEW'), 'SOMETHING.NEW');
  assert.equal(formatAmount(1470, 'USD'), 'USD 1470.00');
  assert.equal(formatAmount(null, 'USD'), '');
});
