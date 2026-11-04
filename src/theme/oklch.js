// oklch to sRGB and WCAG contrast, with no dependencies. Used to derive the sRGB hex chart tokens
// AG Studio needs (it converts only rgb() and color(srgb) for AG Charts' canvas, never oklch) and
// to check every theme's text pairs for WCAG AA in the unit tests.

const OKLCH = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i;

export function parseOklch(text) {
  const match = OKLCH.exec(String(text).trim());
  if (!match) throw new Error(`Not an oklch() colour: ${text}`);
  const lightness = Number(match[1]) / (match[1].includes('.') && Number(match[1]) <= 1 ? 1 : 100);
  return { l: lightness, c: Number(match[2]), h: Number(match[3]), alpha: match[4] === undefined ? 1 : Number(match[4].replace('%', '')) / (match[4].endsWith('%') ? 100 : 1) };
}

// Linear sRGB in 0..1, unclamped (out-of-gamut values are clipped later).
function oklchToLinearSrgb({ l, c, h }) {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S,
  ];
}

const gamma = (value) => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

// sRGB channels 0..255 for an oklch() string. Out-of-gamut channels are clipped.
export function oklchToRgb(text) {
  return oklchToLinearSrgb(parseOklch(text)).map((value) => Math.round(clamp01(gamma(clamp01(value))) * 255));
}

export function oklchToHex(text) {
  return `#${oklchToRgb(text).map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex) {
  const match = /^#([\da-f]{6})$/i.exec(String(hex).trim());
  if (!match) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  return [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16));
}

const toColor = (value) => (String(value).startsWith('#') ? hexToRgb(value) : oklchToRgb(value));

// WCAG 2.x relative luminance and contrast ratio for hex or oklch colours.
export function relativeLuminance(color) {
  const [r, g, b] = toColor(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}
