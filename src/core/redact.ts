// Finding what to black out of a statement before it leaves the device. Pure TypeScript: no React, no network, no model.
//
// The input is what on-device text recognition found on each page: words with the box each one sits in. The output is a list of boxes, each
// with the reason it was chosen, ON by default. Nothing here is final: the person sees every box, turns any off, draws more, and only then are
// the boxes burned into the pixels. Recognition reads text well but misreads digits, so its text is only used to FIND places; the reader is
// given the redacted image itself, never the recognised text.

export interface OcrWord { text: string; /** x0, y0, x1, y1 in pixels of the page image */ box: [number, number, number, number]; conf?: number }
export interface PageWords { width: number; height: number; words: OcrWord[] }

export type RedactReason = 'account' | 'phone' | 'ssn' | 'email' | 'address' | 'name' | 'hidden_word' | 'drawn';
export const REDACT_LABEL: Record<RedactReason, string> = {
  account: 'Account or card number', phone: 'Phone number', ssn: 'Tax or social security number', email: 'Email address',
  address: 'Address', name: 'Name', hidden_word: 'A word you asked to hide', drawn: 'Drawn by you',
};

export interface RedactBox {
  id: string;
  page: number;
  /** position and size as fractions of the page (0 to 1), so they hold at any rendering scale */
  x: number; y: number; w: number; h: number;
  reason: RedactReason;
  /** what was recognised there, shown only to the person while they review; never stored or sent */
  text: string;
  on: boolean;
}

// ---------------------------------------------------------------------------
// Words into lines and column segments
// ---------------------------------------------------------------------------
interface Seg { words: OcrWord[]; text: string; x0: number; y0: number; x1: number; y1: number }

const clean = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (t: string) => (t.match(/\d/g) ?? []).length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Words on one text row, split where a wide gap separates two columns, so a rule can hide one column's address without hiding its neighbour. */
function segments(page: PageWords): Seg[] {
  const h = median(page.words.map((w) => w.box[3] - w.box[1])) || 12;
  const sorted = [...page.words].filter((w) => w.text.trim()).sort((a, b) => (a.box[1] + a.box[3]) - (b.box[1] + b.box[3]));
  const lines: OcrWord[][] = [];
  for (const w of sorted) {
    const cy = (w.box[1] + w.box[3]) / 2;
    const line = lines.find((l) => Math.abs(cy - l.reduce((t, x) => t + (x.box[1] + x.box[3]) / 2, 0) / l.length) < h * 0.6);
    if (line) line.push(w); else lines.push([w]);
  }
  const out: Seg[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.box[0] - b.box[0]);
    let cur: OcrWord[] = [];
    const flush = () => {
      if (!cur.length) return;
      out.push({ words: cur, text: cur.map((w) => w.text).join(' '), x0: Math.min(...cur.map((w) => w.box[0])), y0: Math.min(...cur.map((w) => w.box[1])), x1: Math.max(...cur.map((w) => w.box[2])), y1: Math.max(...cur.map((w) => w.box[3])) });
      cur = [];
    };
    for (const w of line) {
      if (cur.length && w.box[0] - cur[cur.length - 1].box[2] > h * 2.5) flush();
      cur.push(w);
    }
    flush();
  }
  return out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
const LABEL = /\b(account|acct|card|routing|aba|iban|swift|member|policy|ssn|tin|ein|number|no|num)\b\.?#?/i;
const STREET_WORD = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pkwy|parkway|hwy|highway|way|pl|place|cir|circle|trl|trail|ter|terrace|suite|ste|apt|unit|box)\b/i;
const STREET_START = /^\W*(\d{1,6}\s+[A-Za-z]|p\.?\s?[o0]\.?\s?-?\s?box)/i;
const CITY_STATE_ZIP = /[A-Za-z][A-Za-z .'-]*,?\s+[A-Z]{2},?\s+\d{5}(-\d{4})?\s*$/;
const NAME_STOP = /\b(bank|america|statement|account|summary|page|customer|service|information|mail|payment|billing|inquiries|balance|transactions|total|credit|card|purchases|interest|fees|rewards|points|visa|mastercard|date|amount|description|reference|number)\b/i;
/** a number made only of digits and separators, such as 0123456789, 0123-4567-8901 or (404)555-0100 */
const NUMERIC = /^[#(]?\d[\d\-.()]*[\d)]$|^\d$/;
const MASKED = /[•●*xX]{2,}/;

const box = (page: number, i: number, reason: RedactReason, text: string, b: [number, number, number, number], p: PageWords): RedactBox => {
  const pad = Math.max(2, (b[3] - b[1]) * 0.25);
  const x0 = Math.max(0, b[0] - pad), y0 = Math.max(0, b[1] - pad), x1 = Math.min(p.width, b[2] + pad), y1 = Math.min(p.height, b[3] + pad);
  return { id: `${page}:${reason}:${i}`, page, x: x0 / p.width, y: y0 / p.height, w: (x1 - x0) / p.width, h: (y1 - y0) / p.height, reason, text, on: true };
};

const edits = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
/** a recognised word equals the hidden word, allowing one slip of the recogniser in words of five letters or more */
const sameWord = (seen: string, want: string) => !!want && (seen === want || (want.length >= 5 && seen.length >= 5 && edits(seen, want) <= 1));

/** Every word of the page the person asked to hide, as a phrase: "john q public" hides those three words where they appear together. */
function hiddenWords(segs: Seg[], hide: string[]): { seg: Seg; from: number; to: number; phrase: string }[] {
  const out: { seg: Seg; from: number; to: number; phrase: string }[] = [];
  for (const phrase of hide.map((h) => h.trim()).filter(Boolean)) {
    const want = phrase.split(/\s+/).map(clean).filter(Boolean);
    if (!want.length) continue;
    for (const seg of segs) {
      const seen = seg.words.map((w) => clean(w.text));
      for (let i = 0; i + want.length <= seen.length; i++) if (want.every((w, k) => sameWord(seen[i + k], w))) out.push({ seg, from: i, to: i + want.length - 1, phrase });
    }
  }
  return out;
}

/**
 * Everything on the pages that looks sensitive, all switched on. Full account and card numbers keep their last four digits, because the reader
 * needs them to tell which account a statement belongs to. Dates, amounts and transaction descriptions are left alone.
 */
export function findSensitive(pages: PageWords[], opts: { hide?: string[] } = {}): RedactBox[] {
  const out: RedactBox[] = [];
  pages.forEach((p, pageIndex) => {
    if (!p.words.length) return;
    let n = 0;
    const segs = segments(p);
    const push = (reason: RedactReason, text: string, b: [number, number, number, number]) => out.push(box(pageIndex, n++, reason, text, b, p));
    const top = p.height * 0.3;

    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      const ws = seg.words;

      // --- long numbers: grouped so "1234 5678 9012 3456" is one number; the last four digits stay visible
      for (let i = 0; i < ws.length;) {
        const t = ws[i].text;
        if (!NUMERIC.test(t) || MASKED.test(t) || digits(t) < 2 || /^\d{5}-\d{4}$/.test(t)) { i++; continue; }
        let j = i;
        while (j + 1 < ws.length && NUMERIC.test(ws[j + 1].text) && digits(ws[j + 1].text) >= 2 && !/^\d{5}-\d{4}$/.test(ws[j + 1].text)) j++;
        const group = ws.slice(i, j + 1);
        const total = group.reduce((s, w) => s + digits(w.text), 0);
        const joined = group.map((w) => w.text).join(' ');
        const labelled = LABEL.test(ws.slice(Math.max(0, i - 3), i).map((w) => w.text).join(' '));
        const punctuated = /[().-]/.test(joined);
        if (/^\d{3}-\d{2}-\d{4}$/.test(joined.replace(/\s/g, ''))) push('ssn', joined, [seg.x0, seg.y0, seg.x1, seg.y1]);
        else if ((total === 10 || total === 11) && punctuated && group.length >= 1 && /\d{3}[-.)\s]*\d{3}[-.\s]\d{4}/.test(joined.replace(/\s+/g, ' '))) push('phone', joined, [group[0].box[0], seg.y0, group[group.length - 1].box[2], seg.y1]);
        else if (total >= 9 && (labelled || total >= 12 || group[0].box[1] < top)) {
          // keep the last four digits: walk back from the end, then black out what is left of them
          let keep = 4;
          let hideTo = group.length;                    // tokens [0, hideTo) are hidden entirely
          let partial: { token: OcrWord; hiddenFraction: number } | null = null;
          for (let k = group.length - 1; k >= 0 && keep > 0; k--) {
            const d = digits(group[k].text);
            if (d <= keep) { keep -= d; hideTo = k; } else { partial = { token: group[k], hiddenFraction: (d - keep) / d }; hideTo = k; keep = 0; }
          }
          for (let k = 0; k < hideTo; k++) push('account', group[k].text, group[k].box);
          if (partial) { const [x0, y0, x1, y1] = partial.token.box; push('account', partial.token.text, [x0, y0, x0 + (x1 - x0) * partial.hiddenFraction, y1]); }
        }
        i = j + 1;
      }

      // --- email, a social security number inside one word
      for (const w of ws) {
        if (/\S+@\S+\.\S+/.test(w.text)) push('email', w.text, w.box);
        else if (/^\d{3}-\d{2}-\d{4}$/.test(w.text)) push('ssn', w.text, w.box);
      }

      // --- addresses: a street line, or a city / state / zip line
      if ((STREET_START.test(seg.text) && STREET_WORD.test(seg.text)) || CITY_STATE_ZIP.test(seg.text)) {
        push('address', seg.text, [seg.x0, seg.y0, seg.x1, seg.y1]);
        // the line above a street address, in the same column, in capitals, is a name
        if (STREET_START.test(seg.text)) {
          const above = [...segs.slice(0, si)].reverse().find((o) => o.y1 <= seg.y0 + 2 && seg.y0 - o.y1 < (seg.y1 - seg.y0) * 3 && Math.abs(o.x0 - seg.x0) < (seg.y1 - seg.y0) * 4);
          if (above) {
            const words = above.words.map((w) => w.text);
            const letters = above.text.replace(/[^A-Za-z]/g, '');
            const upper = letters.replace(/[^A-Z]/g, '').length;
            if (words.length >= 2 && words.length <= 4 && letters.length >= 4 && upper / letters.length >= 0.75 && !/\d/.test(above.text) && !NAME_STOP.test(above.text)) push('name', above.text, [above.x0, above.y0, above.x1, above.y1]);
          }
        }
      }
    }

    // --- words the person asked to hide (their name, street, employer)
    for (const h of hiddenWords(segs, opts.hide ?? [])) {
      const ws = h.seg.words.slice(h.from, h.to + 1);
      push('hidden_word', h.phrase, [Math.min(...ws.map((w) => w.box[0])), Math.min(...ws.map((w) => w.box[1])), Math.max(...ws.map((w) => w.box[2])), Math.max(...ws.map((w) => w.box[3]))]);
    }
  });
  return dedupe(out);
}

/** A box already covered by another (the same line found by two rules) is dropped, keeping the more specific reason. */
function dedupe(boxes: RedactBox[]): RedactBox[] {
  const rank: Record<RedactReason, number> = { ssn: 0, account: 1, phone: 2, email: 3, hidden_word: 4, name: 5, address: 6, drawn: 7 };
  const inside = (a: RedactBox, b: RedactBox) => a.page === b.page && a.x >= b.x - 0.002 && a.y >= b.y - 0.002 && a.x + a.w <= b.x + b.w + 0.002 && a.y + a.h <= b.y + b.h + 0.002;
  return boxes.filter((a, i) => !boxes.some((b, j) => i !== j && inside(a, b) && (!inside(b, a) || rank[b.reason] < rank[a.reason] || (rank[b.reason] === rank[a.reason] && j < i))));
}

/** A box the person drew, from two corners given as fractions of the page. */
export function drawnBox(page: number, a: { x: number; y: number }, b: { x: number; y: number }, nth: number): RedactBox {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { id: `${page}:drawn:${nth}`, page, x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), reason: 'drawn', text: '', on: true };
}

/** The boxes that are switched on, as pixel rectangles for a page of the given size. */
export const pixelRects = (boxes: RedactBox[], page: number, width: number, height: number): { x: number; y: number; w: number; h: number }[] =>
  boxes.filter((b) => b.page === page && b.on && b.w > 0 && b.h > 0).map((b) => ({ x: Math.floor(b.x * width), y: Math.floor(b.y * height), w: Math.ceil(b.w * width) + 1, h: Math.ceil(b.h * height) + 1 }));

/** How many boxes of each reason are switched on, for the summary line above the review. */
export function countByReason(boxes: RedactBox[]): { reason: RedactReason; on: number; total: number }[] {
  const out = new Map<RedactReason, { on: number; total: number }>();
  for (const b of boxes) { const e = out.get(b.reason) ?? { on: 0, total: 0 }; e.total++; if (b.on) e.on++; out.set(b.reason, e); }
  return [...out.entries()].map(([reason, v]) => ({ reason, ...v }));
}

// ---------------------------------------------------------------------------
// Changes the person makes in the review
// ---------------------------------------------------------------------------

/** Switch one box on or off. */
export const toggleBox = (boxes: RedactBox[], id: string): RedactBox[] => boxes.map((b) => (b.id === id ? { ...b, on: !b.on } : b));

/** Switch every box of one reason on or off at once ("turn off all the addresses"). */
export const setReason = (boxes: RedactBox[], reason: RedactReason, on: boolean): RedactBox[] => boxes.map((b) => (b.reason === reason ? { ...b, on } : b));

/** Take a box away. Only boxes the person drew can be removed; a found box is switched off instead, so it stays visible and can be switched back on. */
export const removeDrawn = (boxes: RedactBox[], id: string): RedactBox[] => boxes.filter((b) => !(b.id === id && b.reason === 'drawn'));

/** The boxes after a new search (for example with another word to hide): found boxes are replaced, the ones the person drew stay, and any found box that
 * was switched off before and is found again at the same place stays off, so a choice made once is not asked again. */
export function withNewSearch(current: RedactBox[], found: RedactBox[]): RedactBox[] {
  const same = (a: RedactBox, b: RedactBox) => a.page === b.page && a.reason === b.reason && Math.abs(a.x - b.x) < 0.004 && Math.abs(a.y - b.y) < 0.004;
  const off = current.filter((b) => b.reason !== 'drawn' && !b.on);
  return [...found.map((b) => (off.some((o) => same(o, b)) ? { ...b, on: false } : b)), ...current.filter((b) => b.reason === 'drawn')];
}

/** Words to always hide, as typed: separated by commas or new lines, blanks dropped, each kept once. */
export const parseHideWords = (text: string): string[] => [...new Set(text.split(/[,\n;]+/).map((w) => w.trim()).filter(Boolean))];
