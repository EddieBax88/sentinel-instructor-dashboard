// The dashboard's three themes, mirroring sentinellearning.com's token sets (oklch, from the live
// site CSS). This file is the single source of truth: scripts/build-theme-css.mjs turns it into
// src/theme-tokens.css (committed, checked by themes.test.js), index.html's inline script reads the
// same storage key before first paint, and ThemeSwitcher.jsx lists THEME_ORDER.
//
// Chart tokens (--chart-*) and the --srgb-* twins are emitted as sRGB hex because AG Studio converts
// computed colours only from rgb() or color(srgb); an oklch token there silently falls back to
// Studio's defaults. Status colours: COMPLETED green, AWAITING PAYMENT amber, REFUNDED red.

import { oklchToHex } from './oklch.js';

export const STORAGE_KEY = 'sentinel-dashboard-theme';
export const DEFAULT_THEME = 'black-yellow';
export const THEME_ORDER = ['black-yellow', 'industrial', 'light'];

const shared = {
  radius: '.75rem',
  'radius-sm': 'calc(var(--radius) - .375rem)',
  font: "'Inter', system-ui, sans-serif",
  'heading-font': "'Fraunces', Georgia, serif",
};

export const THEMES = {
  'black-yellow': {
    label: 'Black & Safety-Yellow',
    short: 'Black',
    colorScheme: 'dark',
    tokens: {
      background: 'oklch(12% .005 260)',
      foreground: 'oklch(98% .005 90)',
      card: 'oklch(16% .008 260)',
      primary: 'oklch(83% .185 88)',
      // Small primary text and button fills: the raw primary already clears AA on these dark
      // surfaces, so the darker step is the primary itself; hover steps go a little darker.
      'primary-strong': 'oklch(83% .185 88)',
      'primary-stronger': 'oklch(76% .17 88)',
      'primary-foreground': 'oklch(12% .01 260)',
      secondary: 'oklch(22% .01 260)',
      muted: 'oklch(20% .008 260)',
      'muted-foreground': 'oklch(72% .015 90)',
      accent: 'oklch(80% .16 80)',
      'accent-foreground': 'oklch(12% .01 260)',
      // Tinted surface for hover, chips and notices, with --primary text on it.
      'accent-soft': 'oklch(24% .03 88)',
      destructive: 'oklch(58% .22 25)',
      'destructive-text': 'oklch(78% .16 25)',
      border: 'oklch(26% .01 260)',
      input: 'oklch(24% .01 260)',
      ring: 'oklch(83% .185 88)',
      'status-completed': 'oklch(28% .06 150)',
      'status-completed-foreground': 'oklch(86% .17 150)',
      'status-completed-strong': 'oklch(75% .17 150)',
      'status-pending': 'oklch(30% .06 80)',
      'status-pending-foreground': 'oklch(88% .15 85)',
      'status-pending-strong': 'oklch(80% .16 85)',
      'status-refunded': 'oklch(28% .08 25)',
      'status-refunded-foreground': 'oklch(82% .15 25)',
      'status-refunded-strong': 'oklch(68% .2 25)',
      shadow: 'oklch(0% 0 0 / .5)',
    },
    chart: {
      text: 'oklch(98% .005 90)',
      subtleText: 'oklch(72% .015 90)',
      line: 'oklch(30% .01 260)',
      palette: ['oklch(83% .185 88)', 'oklch(75% .13 240)', 'oklch(78% .17 150)', 'oklch(74% .17 50)', 'oklch(76% .16 340)', 'oklch(80% .12 195)'],
    },
  },
  industrial: {
    label: 'Industrial',
    short: 'Industrial',
    colorScheme: 'dark',
    tokens: {
      background: 'oklch(21% .03 55)',
      foreground: 'oklch(96% .012 80)',
      card: 'oklch(25% .035 55)',
      primary: 'oklch(66% .21 38)',
      'primary-strong': 'oklch(66% .21 38)',
      'primary-stronger': 'oklch(60% .2 38)',
      'primary-foreground': 'oklch(16% .01 50)',
      secondary: 'oklch(30% .035 55)',
      muted: 'oklch(28% .03 55)',
      'muted-foreground': 'oklch(72% .025 70)',
      accent: 'oklch(82% .17 85)',
      'accent-foreground': 'oklch(16% .01 50)',
      'accent-soft': 'oklch(25% .035 45)',
      destructive: 'oklch(58% .22 25)',
      'destructive-text': 'oklch(80% .15 25)',
      border: 'oklch(32% .018 55)',
      input: 'oklch(30% .016 55)',
      ring: 'oklch(66% .21 38)',
      'status-completed': 'oklch(32% .06 150)',
      'status-completed-foreground': 'oklch(87% .16 150)',
      'status-completed-strong': 'oklch(76% .16 150)',
      'status-pending': 'oklch(35% .07 75)',
      'status-pending-foreground': 'oklch(90% .14 85)',
      'status-pending-strong': 'oklch(82% .17 85)',
      'status-refunded': 'oklch(32% .09 25)',
      'status-refunded-foreground': 'oklch(84% .14 25)',
      'status-refunded-strong': 'oklch(70% .19 25)',
      shadow: 'oklch(0% 0 0 / .45)',
    },
    chart: {
      text: 'oklch(96% .012 80)',
      subtleText: 'oklch(72% .025 70)',
      line: 'oklch(36% .02 55)',
      palette: ['oklch(66% .21 38)', 'oklch(82% .17 85)', 'oklch(76% .16 150)', 'oklch(72% .13 240)', 'oklch(74% .15 350)', 'oklch(78% .12 195)'],
    },
  },
  light: {
    label: 'Light',
    short: 'Light',
    colorScheme: 'light',
    tokens: {
      background: 'oklch(98.5% .003 260)',
      foreground: 'oklch(13% .01 260)',
      card: 'oklch(100% 0 0)',
      primary: 'oklch(58% .19 50)',
      // White on the raw primary is 4.45:1, just under AA for normal text, so buttons and small
      // primary text use this darker step (6.2:1).
      'primary-strong': 'oklch(50% .17 50)',
      'primary-stronger': 'oklch(45% .16 50)',
      'primary-foreground': 'oklch(99% 0 0)',
      secondary: 'oklch(95% .005 260)',
      muted: 'oklch(93% .005 260)',
      'muted-foreground': 'oklch(42% .01 260)',
      accent: 'oklch(92% .015 70)',
      'accent-foreground': 'oklch(13% .01 260)',
      'accent-soft': 'oklch(92% .015 70)',
      destructive: 'oklch(58% .22 25)',
      'destructive-text': 'oklch(50% .2 25)',
      border: 'oklch(86% .006 260)',
      input: 'oklch(90% .005 260)',
      ring: 'oklch(58% .19 50)',
      'status-completed': 'oklch(93% .05 150)',
      'status-completed-foreground': 'oklch(36% .12 150)',
      'status-completed-strong': 'oklch(58% .15 150)',
      'status-pending': 'oklch(94% .07 85)',
      'status-pending-foreground': 'oklch(42% .12 70)',
      'status-pending-strong': 'oklch(62% .14 70)',
      'status-refunded': 'oklch(93% .04 25)',
      'status-refunded-foreground': 'oklch(45% .19 25)',
      'status-refunded-strong': 'oklch(55% .2 25)',
      shadow: 'oklch(13% .01 260 / .08)',
    },
    chart: {
      text: 'oklch(13% .01 260)',
      subtleText: 'oklch(42% .01 260)',
      line: 'oklch(86% .006 260)',
      palette: ['oklch(58% .19 50)', 'oklch(52% .13 262)', 'oklch(60% .14 150)', 'oklch(63% .14 80)', 'oklch(52% .17 325)', 'oklch(52% .09 200)'],
    },
  },
};

export function isThemeName(value) {
  return typeof value === 'string' && Object.hasOwn(THEMES, value);
}

// The chart tokens for one theme, as sRGB hex (see the note at the top).
export function chartTokens(name) {
  const { chart } = THEMES[name];
  return {
    'chart-text': oklchToHex(chart.text),
    'chart-subtle-text': oklchToHex(chart.subtleText),
    'chart-line': oklchToHex(chart.line),
    ...Object.fromEntries(chart.palette.map((color, index) => [`chart-${index + 1}`, oklchToHex(color)])),
  };
}

// sRGB hex twins of every opaque colour token (--srgb-card for --card, and so on). AG Studio resolves
// its theme params in JavaScript through a converter that accepts only rgb() and color(srgb), for
// widget and canvas backgrounds, its inner grids and the charts; an oklch value there falls back to
// Studio's defaults (white backgrounds, dark text). src/analytics/theme.js uses only these.
export function srgbTokens(name) {
  return Object.fromEntries(Object.entries(THEMES[name].tokens)
    .filter(([, value]) => value.startsWith('oklch(') && !value.includes('/'))
    .map(([key, value]) => [`srgb-${key}`, oklchToHex(value)]));
}

// Every custom property one theme sets, in CSS declaration order.
export function themeDeclarations(name) {
  const theme = THEMES[name];
  return { ...theme.tokens, ...shared, ...srgbTokens(name), ...chartTokens(name), 'color-scheme': theme.colorScheme };
}

const block = (selector, declarations) => `${selector} {\n${Object.entries(declarations).map(([key, value]) => `  ${key === 'color-scheme' ? key : `--${key}`}: ${value};`).join('\n')}\n}\n`;

// The generated stylesheet: the default theme on :root, each theme under [data-theme="…"] so an
// explicit attribute wins, and a safe background before the bundle loads (see index.html).
export function themeCss() {
  const header = `/* GENERATED by scripts/build-theme-css.mjs from src/theme/themes.js. Do not edit by hand. */\n`;
  const root = block(':root', themeDeclarations(DEFAULT_THEME));
  const perTheme = THEME_ORDER.map((name) => block(`:root[data-theme="${name}"]`, themeDeclarations(name))).join('\n');
  return `${header}\n${root}\n${perTheme}`;
}

// Theme choice persistence. Storage access is wrapped: private windows, blocked site data or a
// missing window throw, and the dashboard must still render with the default theme.
export function readStoredTheme(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return isThemeName(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(name, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, name);
    return true;
  } catch {
    return false;
  }
}

// The hex a browser's meta theme-color needs for one theme (the page background).
export function themeColor(name) {
  return oklchToHex(THEMES[name].tokens.background);
}

export function applyTheme(name, root = globalThis.document?.documentElement) {
  if (!root) return;
  root.dataset.theme = name;
  root.style.colorScheme = THEMES[name].colorScheme;
  const meta = root.ownerDocument?.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor(name));
}
