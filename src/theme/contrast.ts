import { LIGHT } from './tokens';

// WCAG contrast, for text drawn on a coloured fill (chart blocks, legend chips): the label is dark ink or white, whichever reads better on that
// fill. The choice depends only on the fill, never on the theme, since the fill is the same colour in both.

const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export const contrast = (a: string, b: string) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

/** The more readable of dark ink and white on this fill. */
export const readableOn = (fill: string): string => (contrast(fill, LIGHT.ink) >= contrast(fill, '#FFFFFF') ? LIGHT.ink : '#FFFFFF');
