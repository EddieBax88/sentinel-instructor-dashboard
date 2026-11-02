import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio } from './oklch.js';
import { DEFAULT_THEME, STORAGE_KEY, THEMES, THEME_ORDER, applyTheme, chartTokens, isThemeName, readStoredTheme, srgbTokens, storeTheme, themeColor, themeCss, themeDeclarations } from './themes.js';
import { oklchToHex } from './oklch.js';
import { readFileSync as read } from 'node:fs';

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

// Text on surface pairs the dashboard actually uses (src/styles.css, SeatTable.jsx, theme.js).
const TEXT_PAIRS = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['foreground', 'muted'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary-strong', 'background'],
  ['primary-strong', 'card'],
  ['primary-strong', 'accent-soft'],
  ['primary-foreground', 'primary-strong'],
  ['primary-foreground', 'primary-stronger'],
  ['accent-foreground', 'accent'],
  ['destructive-text', 'muted'],
  ['destructive-text', 'card'],
  ['status-completed-foreground', 'status-completed'],
  ['status-pending-foreground', 'status-pending'],
  ['status-refunded-foreground', 'status-refunded'],
];
// The raw primary is used only for large text (h1 accent, the seat counter, the revenue tile at
// 25px+) and icons, so it needs 3:1 (WCAG AA large text); small primary text uses primary-strong.
const LARGE_TEXT_PAIRS = [
  ['primary', 'background'],
  ['primary', 'card'],
  ['primary-foreground', 'primary'],
];
const GRAPHIC_PAIRS = [
  ['status-completed-strong', 'card'],
  ['status-pending-strong', 'card'],
  ['status-refunded-strong', 'card'],
  ['primary', 'card'],
];

for (const name of THEME_ORDER) {
  const tokens = THEMES[name].tokens;
  const charts = chartTokens(name);

  test(`${name}: every text pair clears WCAG AA (4.5:1) and graphics clear 3:1`, () => {
    const failures = [];
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      if (ratio < AA_TEXT) failures.push(`${fg} on ${bg} = ${ratio}`);
    }
    for (const [fg, bg] of [...LARGE_TEXT_PAIRS, ...GRAPHIC_PAIRS]) {
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      if (ratio < AA_GRAPHIC) failures.push(`${fg} on ${bg} = ${ratio} (large text or graphic)`);
    }
    assert.deepEqual(failures, []);
  });

  test(`${name}: chart text is AA on the card and every palette colour is readable on it`, () => {
    assert.ok(contrastRatio(charts['chart-text'], tokens.card) >= AA_TEXT, `chart-text ${charts['chart-text']}`);
    assert.ok(contrastRatio(charts['chart-subtle-text'], tokens.card) >= AA_TEXT, `chart-subtle-text ${charts['chart-subtle-text']}`);
    for (let index = 1; index <= 6; index += 1) {
      const hex = charts[`chart-${index}`];
      assert.match(hex, /^#[\da-f]{6}$/, `chart-${index} must be sRGB hex for AG Studio, got ${hex}`);
      assert.ok(contrastRatio(hex, tokens.card) >= AA_GRAPHIC, `chart-${index} ${hex} on card = ${contrastRatio(hex, tokens.card)}`);
    }
    // Chart 1 is the brand primary of that theme.
    assert.equal(charts['chart-1'], chartTokens(name)['chart-1']);
  });
}

test('the three themes carry the token sets from sentinellearning.com', () => {
  assert.deepEqual(THEME_ORDER, ['black-yellow', 'industrial', 'light']);
  assert.equal(DEFAULT_THEME, 'black-yellow');
  assert.equal(THEMES['black-yellow'].label, 'Black & Safety-Yellow');
  const by = THEMES['black-yellow'].tokens;
  assert.deepEqual([by.background, by.foreground, by.card, by.primary, by.accent, by.border, by.input, by.ring],
    ['oklch(12% .005 260)', 'oklch(98% .005 90)', 'oklch(16% .008 260)', 'oklch(83% .185 88)', 'oklch(80% .16 80)', 'oklch(26% .01 260)', 'oklch(24% .01 260)', 'oklch(83% .185 88)']);
  const ind = THEMES.industrial.tokens;
  assert.deepEqual([ind.background, ind.foreground, ind.card, ind.primary, ind.accent, ind.border, ind.input, ind.ring],
    ['oklch(21% .03 55)', 'oklch(96% .012 80)', 'oklch(25% .035 55)', 'oklch(66% .21 38)', 'oklch(82% .17 85)', 'oklch(32% .018 55)', 'oklch(30% .016 55)', 'oklch(66% .21 38)']);
  const light = THEMES.light.tokens;
  assert.deepEqual([light.background, light.foreground, light.primary, light['primary-strong']], ['oklch(98.5% .003 260)', 'oklch(13% .01 260)', 'oklch(58% .19 50)', 'oklch(50% .17 50)']);
  // The light chart primary is the same hex yesterday's hand conversion produced.
  assert.equal(chartTokens('light')['chart-1'], '#cd4b00');
  for (const name of THEME_ORDER) {
    assert.equal(themeDeclarations(name).font, "'Inter', system-ui, sans-serif");
    assert.equal(themeDeclarations(name)['heading-font'], "'Fraunces', Georgia, serif");
  }
});

test('every opaque colour token has an --srgb-* hex twin, and the Studio theme uses only those for colours', () => {
  for (const name of THEME_ORDER) {
    const twins = srgbTokens(name);
    for (const key of ['background', 'foreground', 'card', 'primary', 'border', 'muted', 'muted-foreground', 'accent-soft']) {
      assert.equal(twins[`srgb-${key}`], oklchToHex(THEMES[name].tokens[key]), `${name} ${key}`);
    }
    assert.equal(twins['srgb-shadow'], undefined, 'translucent tokens have no twin');
  }
  // Studio resolves colours in JavaScript from rgb()/color(srgb) only, so no colour param may point at an oklch token.
  const studioTheme = read(new URL('../analytics/theme.js', import.meta.url), 'utf8');
  const oklchColourParams = [...studioTheme.matchAll(/^\s+(\w*(?:Color|Border|Colour))\w*: token\('([\w-]+)'\)/gm)].map((match) => match[1]);
  assert.deepEqual(oklchColourParams.filter((param) => !/^chart/.test(param)), []);
  assert.match(studioTheme, /backgroundColor: srgb\('card'\)/);
  assert.match(studioTheme, /studioWidgetBackgroundColor: srgb\('card'\)/);
});

test('src/theme-tokens.css is the generator output (run node scripts/build-theme-css.mjs)', () => {
  const committed = readFileSync(new URL('../theme-tokens.css', import.meta.url), 'utf8');
  assert.equal(committed, themeCss());
  assert.match(committed, /^:root \{/m);
  for (const name of THEME_ORDER) assert.match(committed, new RegExp(`^:root\\[data-theme="${name}"\\] \\{`, 'm'));
});

test('index.html applies the stored theme before first paint with the same storage key and names', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const inlineScript = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
  assert.ok(inlineScript.indexOf('localStorage') >= 0 && html.indexOf('<script>') < html.indexOf('<script type="module"'), 'inline theme script must run before the module bundle');
  assert.match(inlineScript, new RegExp(STORAGE_KEY));
  assert.match(inlineScript, /try\s*\{/);
  for (const name of THEME_ORDER) assert.match(inlineScript, new RegExp(`"${name}"`));
  assert.match(inlineScript, new RegExp(`"${DEFAULT_THEME}"`));
});

test('theme choice survives a broken localStorage and rejects unknown names', () => {
  assert.equal(readStoredTheme({ getItem: () => 'industrial' }), 'industrial');
  assert.equal(readStoredTheme({ getItem: () => 'neon' }), DEFAULT_THEME);
  assert.equal(readStoredTheme({ getItem: () => { throw new Error('blocked'); } }), DEFAULT_THEME);
  assert.equal(readStoredTheme(undefined), DEFAULT_THEME);
  const saved = {};
  assert.equal(storeTheme('light', { setItem: (key, value) => { saved[key] = value; } }), true);
  assert.deepEqual(saved, { [STORAGE_KEY]: 'light' });
  assert.equal(storeTheme('light', { setItem: () => { throw new Error('quota'); } }), false);
  assert.equal(isThemeName('light'), true);
  assert.equal(isThemeName('__proto__'), false);
  assert.equal(isThemeName(42), false);
});

test('applyTheme sets the attribute, colour scheme and meta theme-color', () => {
  const meta = { content: '', setAttribute(_name, value) { this.content = value; } };
  const root = { dataset: {}, style: {}, ownerDocument: { querySelector: () => meta } };
  applyTheme('industrial', root);
  assert.equal(root.dataset.theme, 'industrial');
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(meta.content, themeColor('industrial'));
  applyTheme('light', root);
  assert.equal(root.style.colorScheme, 'light');
  assert.doesNotThrow(() => applyTheme('light', undefined));
});
