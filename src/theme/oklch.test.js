import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, hexToRgb, oklchToHex, oklchToRgb, parseOklch, relativeLuminance } from './oklch.js';

test('parses oklch() with percent lightness and an optional alpha', () => {
  assert.deepEqual(parseOklch('oklch(83% .185 88)'), { l: 0.83, c: 0.185, h: 88, alpha: 1 });
  assert.deepEqual(parseOklch('oklch(12% .005 260 / .5)'), { l: 0.12, c: 0.005, h: 260, alpha: 0.5 });
  assert.throws(() => parseOklch('#ffffff'), /Not an oklch/);
});

test('converts known oklch colours to sRGB (white, black, and the brand primary)', () => {
  assert.equal(oklchToHex('oklch(100% 0 0)'), '#ffffff');
  assert.equal(oklchToHex('oklch(0% 0 0)'), '#000000');
  // oklch(58% .19 50) is the light-theme brand primary; yesterday's hand-converted token was #cd4b00.
  const [r, g, b] = oklchToRgb('oklch(58% .19 50)');
  assert.ok(Math.abs(r - 0xcd) <= 2 && Math.abs(g - 0x4b) <= 2 && Math.abs(b - 0x00) <= 2, `got ${[r, g, b]}`);
});

test('contrast ratio matches the WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#777777', '#ffffff'), 4.48);
  assert.deepEqual(hexToRgb('#cd4b00'), [0xcd, 0x4b, 0]);
  assert.equal(relativeLuminance('#ffffff'), 1);
});
