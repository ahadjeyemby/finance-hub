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

/** A translucent rgba() colour laid over an opaque hex one, as the screen shows it. */
function over(rgba: string, base: string): string {
  const [r, g, b, a] = rgba.replace(/rgba\(|\)/g, '').split(',').map(Number);
  const n = parseInt(base.slice(1), 16);
  const mix = (top: number, bottom: number) => Math.round(top * a + bottom * (1 - a)).toString(16).padStart(2, '0');
  return `#${mix(r, (n >> 16) & 255)}${mix(g, (n >> 8) & 255)}${mix(b, n & 255)}`;
}

for (const [name, p] of [['light', LIGHT], ['dark', DARK]] as const) {
  test(`${name} theme: every text and surface pair reaches 4.5:1`, () => {
    for (const [fg, bg] of PAIRS) {
      const f = fg === '#FFFFFF' ? fg : p[fg];
      const ratio = contrast(f, p[bg]);
      assert.ok(ratio >= 4.5, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
    }
  });

  test(`${name} theme: the hero tile's chip text reads at 4.5:1, and heroSoft is only used for large figures (3:1)`, () => {
    const chip = over(p.heroChip, p.hero);
    assert.ok(contrast(p.onHero, chip) >= 4.5, `onHero on the chip: ${contrast(p.onHero, chip).toFixed(2)}`);
    assert.ok(contrast(p.onHero, p.hero) >= 4.5);
    assert.ok(contrast(p.heroSoft, p.hero) >= 3, `heroSoft on hero (large text only): ${contrast(p.heroSoft, p.hero).toFixed(2)}`);
  });
}
