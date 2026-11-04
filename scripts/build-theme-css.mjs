// Writes src/theme-tokens.css from src/theme/themes.js. Run after changing a theme:
//   node scripts/build-theme-css.mjs
// src/theme/themes.test.js fails when the committed file is out of date.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { themeCss } from '../src/theme/themes.js';

const target = fileURLToPath(new URL('../src/theme-tokens.css', import.meta.url));
writeFileSync(target, themeCss());
console.log(`wrote ${target}`);
