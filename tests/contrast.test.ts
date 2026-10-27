import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrast } from '../src/theme/contrast';
import { DARK, LIGHT } from '../src/theme/tokens';
import type { Palette } from '../src/theme/tokens';

// Every text colour the dashboard puts on a surface must reach 4.5:1 in both themes (brief, section 8).
const PAIRS: [keyof Palette | '#FFFFFF', keyof Palette][] = [
  ['ink', 'paper'], ['ink2', 'paper'], ['ink3', 'paper'], ['ink', 'ground'], ['ink2', 'ground'], ['ink3', 'ground'],
  ['ink2', 'side'], ['ink3', 'side'], ['ink2', 'seg'], ['ink3', 'seg'], ['ink', 'field'],
  ['accentInk', 'paper'], ['accentInk', 'accentSoft'], ['onAccent', 'accent'],
  ['warnInk', 'warnBg'], ['goodInk', 'goodSoft'], ['goodInk', 'paper'], ['bad', 'paper'],
  ['ctaInk', 'cta'], ['#FFFFFF', 'hero'],
];

for (const [name, p] of [['light', LIGHT], ['dark', DARK]] as const) {
  test(`${name} theme: every text and surface pair reaches 4.5:1`, () => {
    for (const [fg, bg] of PAIRS) {
      const f = fg === '#FFFFFF' ? fg : p[fg];
      const ratio = contrast(f, p[bg]);
      assert.ok(ratio >= 4.5, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
    }
  });
}
