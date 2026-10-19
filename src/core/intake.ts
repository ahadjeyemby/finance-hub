// Intake: what the app does with a receipt or statement BEFORE anything is saved.
//
//   1. a reader (the edge function, or any extractor) produces a draft with whatever it could find
//   2. analyse*() lists every detail that is missing and every number that does not add up
//   3. the person answers each gap, or says "not printed on it"; they confirm each problem or fix the value
//   4. only an analysis with no gaps and no problems may be saved
//
// Pure TypeScript, no React, no network: everything here is unit tested.
import { classifyRow, makeId, pairTransfers } from './classify';
import { findTwins } from './dedupe';
import type { Sameness, Twin } from './dedupe';
import { itemLines, matchReceipt, receiptUnits } from './evidence';
import type { MatchOptions, RawRecord, ReceiptCharge, ReceiptLine, ReceiptRecord, StatementRecord } from './evidence';
import { hasNumber } from './accounts';
import { parseLines } from './questions';
import type { Account, AccountType, Txn } from './types';

export type DocKind = 'receipt' | 'statement';

export interface Gap {
  /** stable key; also what "not printed" and the answer are recorded against */
  id: string;
  /** which field of the draft the answer fills, e.g. 'merchant' or 'row.3.date' */
  field: string;
  label: string;
  question: string;
  input: 'text' | 'date' | 'money' | 'last4' | 'choice' | 'items';
  options?: { value: string; label: string }[];
  /** true when "this is not printed on the document" is an acceptable answer */
  canSkip: boolean;
  /** answers worth offering with one tap, learned from what the person confirmed before */
  suggest?: { value: string; label: string }[];
}
export interface Problem { id: string; text: string; /** button text for "go ahead anyway"; default is for numbers that disagree */ confirm?: string }
export interface Analysis {
  gaps: Gap[];
  /** numbers that do not agree, or data that looks wrong. Each needs a fix or an explicit "keep as printed". */
  problems: Problem[];
  /** information only, never blocks */
  notes: string[];
  /** nothing left to ask: safe to save */
  ok: boolean;
}
export interface Answers { notPrinted: string[]; acknowledged: string[] }
export const noAnswers = (): Answers => ({ notPrinted: [], acknowledged: [] });

// ---------- parsing what a person types ----------
export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

/** "84.19", "$1,084.19", "-12.5", "(12.50)" -> cents, or null when it is not a number */
export function parseMoneyCents(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/^\$/, ''));
  const digits = t.replace(/[()$,\s-]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const c = Math.round(Number(digits) * 100);
  return neg ? -c : c;
}

/** "2026-08-02", "08/02/2026", "8/2/26" -> ISO, or null */
export function parseDateISO(text: string): string | null {
  const t = text.trim();
  const direct = t.match(/^\d{4}-\d{2}-\d{2}$/) ? t : null;
  if (direct && isIsoDate(direct)) return direct;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

const usd = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const blank = (s?: string | null) => !s || !s.trim();
const CARD_WORDS = /visa|master|amex|american express|discover|credit|debit|card|contactless|chip|\bVI\b|\bMC\b/i;

// ======================================================================
// Receipts
// ======================================================================

/** Sales tax is only worth asking about when the items fall short of the total. Fuel and other tax-inclusive sales print no tax line and the items already equal the total. */
const taxCouldExplainGap = (r: ReceiptRecord) => typeof r.totalCents === 'number' && Math.abs(r.lines.reduce((t, l) => t + l.cents, 0) + (r.charges ?? []).reduce((t, x) => t + x.cents, 0) - r.totalCents) > 1;

/** `same`: what the caller found when it looked for this purchase among stored receipts (see dedupe.findSameReceipt). */
export function analyseReceipt(r: ReceiptRecord, a: Answers, today: string, same?: Sameness | null): Analysis {
  const gaps: Gap[] = [];
  const problems: Problem[] = [];
  const notes: string[] = [];
  const skipped = (id: string) => a.notPrinted.includes(id);
  const ask = (g: Gap, missing: boolean) => { if (missing && !(g.canSkip && skipped(g.id))) gaps.push(g); };

  ask({ id: 'merchant', field: 'merchant', label: 'Store', question: 'Which store or seller is this from?', input: 'text', canSkip: false }, blank(r.merchant));
  ask({ id: 'date', field: 'date', label: 'Date', question: 'What date is on it? (YYYY-MM-DD or MM/DD/YYYY)', input: 'date', canSkip: false }, !isIsoDate(r.date));
  ask({ id: 'total', field: 'total', label: 'Total paid', question: 'What is the total amount paid?', input: 'money', canSkip: false }, !(typeof r.totalCents === 'number' && r.totalCents > 0));
  ask({ id: 'lines', field: 'lines', label: 'Items', question: 'What did you buy? One per line as "item price", for example "milk 4.50".', input: 'items', canSkip: true }, r.lines.length === 0);

  // recommended: kept for evidence and matching, so asked once; "not printed" is a fine answer
  // the time is kept when printed and used to tell same-day repeat purchases apart, but a receipt without one is never questioned: the date is what matters
  ask({ id: 'paymentMethod', field: 'paymentMethod', label: 'Paid with', question: 'How was it paid (cash, Visa, Mastercard, gift card...)?', input: 'text', canSkip: true }, blank(r.paymentMethod));
  ask({ id: 'cardLast4', field: 'cardLast4', label: 'Card last 4', question: 'Last 4 digits of the card, as printed?', input: 'last4', canSkip: true }, !blank(r.paymentMethod) && CARD_WORDS.test(r.paymentMethod!) && blank(r.cardLast4));
  ask({ id: 'tax', field: 'tax', label: 'Sales tax', question: 'How much sales tax is printed? Enter 0 if none.', input: 'money', canSkip: true }, r.lines.length > 0 && r.taxCents == null && taxCouldExplainGap(r));
  ask({ id: 'storeAddress', field: 'storeAddress', label: 'Store address', question: 'What store address or location is printed?', input: 'text', canSkip: true }, blank(r.storeAddress) && r.kind !== 'order_confirmation');
  ask({ id: 'orderRef', field: 'orderRef', label: 'Order number', question: 'What is the order number?', input: 'text', canSkip: true }, r.kind === 'order_confirmation' && blank(r.orderRef));

  if (same && r.dup !== 'different') {
    const what = `${same.of.merchant ?? 'a receipt'}, ${same.of.date ?? 'no date'}, ${same.of.totalCents != null ? usd(same.of.totalCents) : 'no total'} (${same.of.label})`;
    if (same.level === 'same' || r.dup === 'extra') notes.push(`This looks like another document for ${what}: ${same.why}. It is kept as an extra document and adds no new purchase.`);
    else ask({ id: 'dup', field: 'dup', label: 'Same purchase?', question: `This looks like ${what}: ${same.why}. Is it the same purchase?`, input: 'choice', options: [{ value: 'extra', label: 'Same purchase, keep as an extra document' }, { value: 'different', label: 'A different purchase' }], canSkip: false }, true);
  }

  // the printed count is the cheapest way to catch an item printed over two rows and read as two
  if (r.itemCount && r.lines.length) {
    const units = receiptUnits(r.lines);
    const bought = itemLines(r.lines).length; const discounts = r.lines.length - bought;
    if (bought !== r.itemCount && units !== r.itemCount) problems.push({ id: 'count', text: `The receipt prints ${r.itemCount} item${r.itemCount > 1 ? 's' : ''} sold, but ${bought} line${bought > 1 ? 's were' : ' was'} read${discounts ? ` (not counting ${discounts} discount line${discounts > 1 ? 's' : ''})` : ''}. An item printed over two rows may have been read as two, or a line is missing. Items bought in a quantity count as that many (8 avocados is 8): add “x8” after the name under Check or edit details, then press Apply and re-check. A weighed item counts as one.` });
  }

  if (r.cardLast4 && !/^\d{4}$/.test(r.cardLast4)) problems.push({ id: 'last4', text: `Card digits "${r.cardLast4}" are not four digits. Correct them, or keep as printed.` });

  const total = r.totalCents ?? 0;
  if (r.lines.length && total > 0) {
    const items = r.lines.reduce((s, l) => s + l.cents, 0);
    const other = Math.abs(r.paidOtherCents ?? 0);
    const extra = (r.charges ?? []).reduce((t, x) => t + x.cents, 0);
    const expected = items + (r.taxCents ?? 0) + (r.tipCents ?? 0) + extra - Math.abs(r.discountCents ?? 0) - other;
    if (Math.abs(expected - total) > 1) {
      problems.push({ id: 'sum', text: `Items ${usd(items)}${r.taxCents ? ` plus tax ${usd(r.taxCents)}` : ''}${r.tipCents ? ` plus tip ${usd(r.tipCents)}` : ''}${(r.charges ?? []).map((x) => ` plus ${x.label} ${usd(x.cents)}`).join('')}${r.discountCents ? ` minus discount ${usd(Math.abs(r.discountCents))}` : ''}${other ? ` minus ${usd(other)} paid with ${r.paidOtherLabel ?? 'points or credit'}` : ''} come to ${usd(expected)}, but the total is ${usd(total)} (difference ${usd(total - expected)}). A line may be missing or misread, or the total may include something else.${Math.abs(total - expected) % 100 === 0 ? ` A gap of exactly ${usd(Math.abs(total - expected))} is typical of one digit misread in one price (24.99 read as 7.99, for example): compare the prices with the image.` : ''}${other ? ' The amount subtracted for points or credit is the likely culprit if it was really your card payment: set “Paid with points, gift card or credit” to 0 under Check or edit details, then press Apply and re-check.' : ''}` });
    }
    if (r.subtotalCents != null && Math.abs(items - r.subtotalCents) > 1) {
      problems.push({ id: 'subtotal', text: `The items add up to ${usd(items)} but the printed subtotal is ${usd(r.subtotalCents)}. A line may be missing or misread.` });
    }
  }
  for (const n of r.corrections ?? []) notes.push(n);
  if (r.paidOtherCents) notes.push(`${usd(Math.abs(r.paidOtherCents))} of this order was paid with ${r.paidOtherLabel ?? 'points or credit'}, so the card was charged ${r.totalCents != null ? usd(r.totalCents) : 'less than the order total'}. The items are kept as evidence and are not split across the card charge.`);
  if (r.refundCents) {
    const back = (r.refundedLines ?? []).reduce((t, l) => t + l.cents, 0);
    const tax = r.taxCents ?? 0;
    // a refund covers the returned items and the tax paid on them, so it sits between the two
    if (r.refundedLines?.length && (r.refundCents < back - 1 || r.refundCents > back + tax + 1)) problems.push({ id: 'refund', text: `The refund total is ${usd(r.refundCents)}, but the returned items come to ${usd(back)}${tax ? ` and the tax on the whole order is ${usd(tax)}` : ''}, so a refund should be between ${usd(back)} and ${usd(back + tax)}. A returned item may be missing or misread.` });
    else if (!r.refundedLines?.length) notes.push(`A refund of ${usd(r.refundCents)} is shown, but no returned items were read. Add them under Items if you want them recorded.`);
    const kept = r.lines.reduce((t, l) => t + l.cents, 0) - back;
    notes.push(`A refund of ${usd(r.refundCents)} was issued${r.refundedLines?.length ? ` for ${r.refundedLines.map((l) => l.item.slice(0, 40)).join(', ')}` : ''}. The receipt does not say whether it went back to the card, to points, or both. ${r.refundedLines?.length ? `The items kept come to ${usd(kept)} before tax. ` : ''}Nothing in your ledger is changed by the refund line: a credit on the card shows up from the statement as a refund.`);
  }
  if (isIsoDate(r.date) && r.date > today) problems.push({ id: 'future', text: `The date ${r.date} is in the future.` });
  if (isIsoDate(r.date) && r.date < `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`) problems.push({ id: 'old', text: `The date ${r.date} is more than three years ago. Check the year.` });

  const open = problems.filter((p) => !a.acknowledged.includes(p.id));
  return { gaps, problems: open, notes, ok: gaps.length === 0 && open.length === 0 };
}

/** Put a typed answer into a receipt. Returns the unchanged record when the text cannot be read, with the reason. */
export function setReceiptField(r: ReceiptRecord, field: string, text: string): { record: ReceiptRecord; error?: string } {
  const t = text.trim();
  const money = (key: 'totalCents' | 'subtotalCents' | 'taxCents' | 'tipCents') => { const c = parseMoneyCents(t); return c == null ? { record: r, error: 'Enter an amount like 12.50.' } : { record: { ...r, [key]: Math.abs(c) } }; };
  switch (field) {
    case 'merchant': return { record: { ...r, merchant: t } };
    case 'date': { const d = parseDateISO(t); return d ? { record: { ...r, date: d } } : { record: r, error: 'Use YYYY-MM-DD or MM/DD/YYYY.' }; }
    case 'time': return { record: { ...r, time: t } };
    case 'total': return money('totalCents');
    case 'subtotal': return money('subtotalCents');
    case 'tax': return money('taxCents');
    case 'tip': return money('tipCents');
    case 'paidOther': { const c = parseMoneyCents(t || '0'); return c == null ? { record: r, error: 'Enter an amount like 20.24, or 0 for none.' } : { record: { ...r, paidOtherCents: Math.abs(c) || undefined } }; }
    case 'refundTotal': { const c = parseMoneyCents(t || '0'); return c == null ? { record: r, error: 'Enter an amount like 19.38, or 0 for none.' } : { record: { ...r, refundCents: Math.abs(c) || undefined } }; }
    case 'charges': {
      if (!t) return { record: { ...r, charges: undefined } };
      const p = parseLines(t);
      if (p.bad.length) return { record: r, error: `Could not read: ${p.bad.join(', ')}. Use "label amount", one per line, for example "Service charge 0.96".` };
      // keep the percentage and type the reader found for any charge the person left unchanged
      const charges: ReceiptCharge[] = p.lines.map((l) => { const cents = Math.round(l.amount * 100); return r.charges?.find((x) => x.label === l.item && x.cents === cents) ?? { label: l.item, cents }; });
      return { record: { ...r, charges } };
    }
    case 'paymentMethod': return { record: { ...r, paymentMethod: t } };
    case 'cardLast4': return /^\d{4}$/.test(t) ? { record: { ...r, cardLast4: t } } : { record: r, error: 'Four digits.' };
    case 'storeAddress': return { record: { ...r, storeAddress: t } };
    case 'storeRef': return { record: { ...r, storeRef: t } };
    case 'orderRef': return { record: { ...r, orderRef: t } };
    case 'dup': return t === 'extra' || t === 'different' ? { record: { ...r, dup: t } } : { record: r, error: 'Choose one.' };
    case 'lines': {
      const p = parseLines(t, true);
      if (p.bad.length) return { record: r, error: `Could not read: ${p.bad.join(', ')}. Use "item price", and a minus sign for a discount line, for example "New price -2.50".` };
      // keep the SKU, quantity and unit price the reader found for any line the person left unchanged
      // a line the person left as it was keeps everything the reader found (SKU, unit price); a changed or new line takes its quantity or weight from what was typed
      const lines: ReceiptLine[] = p.lines.map((l) => { const cents = Math.round(l.amount * 100); const same = r.lines.find((x) => lineName(x) === l.item && x.cents === cents); if (same) return same; const q = splitQuantity(l.item); const old = r.lines.find((x) => x.item === q.item && x.cents === cents); return { ...(old ?? {}), item: q.item, cents, ...(q.qty ? { qty: q.qty } : { qty: undefined }), ...(q.weight ? { weight: q.weight, weightUnit: q.weightUnit } : { weight: undefined, weightUnit: undefined }) }; });
      return { record: { ...r, lines } };
    }
    default: return { record: r, error: `Unknown field ${field}` };
  }
}

/** A line as the person sees and edits it, without its price: "AVOCADOS x8", "ZUCCHINI 1.64 lb". */
const lineName = (l: ReceiptLine) => `${l.item}${l.qty && l.qty > 1 ? ` x${l.qty}` : ''}${l.weight ? ` ${l.weight} ${l.weightUnit ?? 'lb'}` : ''}`;
export const linesToText = (lines: ReceiptLine[]) => lines.map((l) => `${lineName(l)} ${(l.cents / 100).toFixed(2)}`).join('\n');

/** "AVOCADOS x8" -> name AVOCADOS, quantity 8. "ZUCCHINI 1.64 lb" -> weight 1.64 lb. Anything else is just a name. */
function splitQuantity(text: string): { item: string; qty?: number; weight?: number; weightUnit?: string } {
  let item = text.trim(); let qty: number | undefined; let weight: number | undefined; let weightUnit: string | undefined;
  const q = item.match(/\s+x\s?(\d+)\s*$/i);
  if (q) { qty = Number(q[1]); item = item.slice(0, q.index).trim(); }
  const w = item.match(/\s+(\d+(?:\.\d+)?)\s?(lbs?|kg|oz|g)\s*$/i);
  if (w) { weight = Number(w[1]); weightUnit = w[2].toLowerCase().replace(/^lbs$/, 'lb'); item = item.slice(0, w.index).trim(); }
  return { item: item || text.trim(), ...(qty && qty > 1 ? { qty } : {}), ...(weight ? { weight, weightUnit } : {}) };
}

/** how a receipt relates to the ledger: one charge, several, or none */
export function linkReceipt(r: ReceiptRecord, txns: Txn[], opts?: MatchOptions) { return matchReceipt(r, txns, 4, opts); }

// ======================================================================
// Statements
// ======================================================================

export interface StatementRow { date?: string; description?: string; /** account holder's view: negative = money out */ cents?: number; section?: string; page?: number }
/** One line of a points or cash-back table. It is not a charge to the card: it never touches the balance owed. */
export interface RewardsLine {
  /** 'return' = a credit that gives points back, 'purchase_or_redemption' = something paid for with points (same names the desktop script stores) */
  section: 'return' | 'purchase_or_redemption';
  date?: string; description: string;
  /** dollars as printed: a purchase or redemption is positive, a credit negative */
  amount: number;
  points?: number;
}
export interface RewardsInfo {
  activity: RewardsLine[];
  /** the printed points summary, label as printed -> points */
  summary?: Record<string, number>;
  availableForRedemption?: number;
}

export interface StatementDraft {
  institution?: string; last4?: string; product?: string;
  accountType?: Extract<AccountType, 'checking' | 'credit'>;
  periodFrom?: string; periodTo?: string; issuedOn?: string; dueOn?: string;
  /** checking: balance. credit card: amount owed (positive). */
  openingCents?: number; closingCents?: number;
  rows: StatementRow[];
  /** answer to "these rows may already be stored": skip them, or add them as different transactions */
  dupRows?: 'skip' | 'add';
  totals?: Record<string, number>;
  terms?: Record<string, unknown>;
  pages?: number;
  /** points or cash-back tables on the statement. Kept with the statement, never counted as card transactions. */
  rewards?: RewardsInfo;
  /** the reader stopped before the end (output limit) */
  truncated?: boolean;
  /** the model that read the file */
  readBy?: string;
  /** what reading the statement twice changed or found: shown as notes on the review card */
  corrections?: string[];
  /** rows whose amount came out differently on a second reading, with that other amount: the first places to look when the balance is off */
  checkRows?: { index: number; otherCents: number }[];
  /** everything else the reader returned */
  raw?: Record<string, unknown>;
}

export interface StatementContext {
  accounts: Account[];
  /** statements already stored */
  statements: { id: string; accountId: string | null; periodFrom: string | null; periodTo: string | null }[];
  /** ledger rows already stored. When given, rows this statement repeats are found and not added twice. */
  existing?: Txn[];
}

/** The ids the rows will be saved under, in order. Rows that are not complete yet get '' (they can never match). */
export function rowIds(d: StatementDraft, accountId: string): string[] {
  const seen = new Map<string, number>();
  return d.rows.map((r) => (isIsoDate(r.date) && !blank(r.description) && Number.isInteger(r.cents) ? makeId(accountId, r.date, r.cents as number, r.description!.trim(), seen) : ''));
}

/** Rows of this statement that are already stored for the same account. */
export function statementTwins(d: StatementDraft, ctx: StatementContext): Twin[] {
  if (!ctx.existing?.length || !d.institution || !/^\d{4}$/.test(d.last4 ?? '') || !d.accountType) return [];
  const acct = resolveAccount(d, ctx.accounts);
  if (!acct) return [];                       // a new account has nothing stored yet
  return findTwins(d.rows, rowIds(d, acct.id), ctx.existing, acct.id);
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['bank', 'the', 'and', 'card', 'credit', 'checking'].includes(w));

/** The stored account this statement belongs to: same last 4 and a shared institution word. null = a new account. */
export function resolveAccount(d: StatementDraft, accounts: Account[]): Account | null {
  if (!d.last4 || blank(d.institution)) return null;
  const w = new Set(words(d.institution!));
  return accounts.find((a) => hasNumber(a, d.last4) && (w.size === 0 || words(a.institution).some((x) => w.has(x)) || words(a.name).some((x) => w.has(x)))) ?? null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function newAccountFor(d: StatementDraft): Account {
  const type = d.accountType ?? 'checking';
  const kind = type === 'credit' ? 'card' : (d.product && /sav/i.test(d.product) ? 'savings' : 'checking');
  return { id: `${slug(d.institution ?? 'account')}-${kind}-${d.last4}`, name: `${d.institution} ${kind} ${d.last4}`, institution: d.institution!, type, last4: d.last4!, coverage: { from: d.periodFrom!, to: d.periodTo! }, incomeComplete: false };
}

const dayMs = 86400000;

/** The shortest block of rows at the end of the list (2 to 12) that adds to `target`. A points table is the last thing read, so this is where it shows up. */
export function trailingRowsAddingUpTo(values: number[], target: number): number[] | null {
  if (target === 0) return null;
  let sum = 0;
  for (let k = 1; k <= Math.min(12, values.length - 1); k++) {
    sum += values[values.length - k];
    if (k >= 2 && sum === target) return values.slice(values.length - k).map((_, j) => values.length - k + j);
  }
  return null;
}

/** The smallest group (2 to 4) of values that adds to `target`, as indexes. null when none, or when several groups of that size fit (then it would be a guess). */
export function rowsAddingUpTo(values: number[], target: number): number[] | null {
  const n = values.length;
  if (n > 60 || target === 0) return null;
  for (let size = 2; size <= 4; size++) {
    const found: number[][] = [];
    const walk = (start: number, left: number, sum: number, picked: number[]) => {
      if (found.length > 1) return;
      if (left === 0) { if (sum === target) found.push([...picked]); return; }
      for (let i = start; i <= n - left; i++) { picked.push(i); walk(i + 1, left - 1, sum + values[i], picked); picked.pop(); }
    };
    walk(0, size, 0, []);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}

export function analyseStatement(d: StatementDraft, ctx: StatementContext, a: Answers, today: string): Analysis {
  const gaps: Gap[] = [];
  const problems: Problem[] = [];
  const notes: string[] = [];
  const ask = (g: Gap, missing: boolean) => { if (missing && !(g.canSkip && a.notPrinted.includes(g.id))) gaps.push(g); };

  ask({ id: 'institution', field: 'institution', label: 'Bank or issuer', question: 'Which bank or card issuer is this statement from?', input: 'text', canSkip: false }, blank(d.institution));
  ask({ id: 'last4', field: 'last4', label: 'Account last 4', question: 'Last 4 digits of the account or card number?', input: 'last4', canSkip: false }, !/^\d{4}$/.test(d.last4 ?? ''));
  ask({ id: 'accountType', field: 'accountType', label: 'Account type', question: 'Is this a checking or savings account, or a credit card?', input: 'choice', options: [{ value: 'checking', label: 'Checking or savings' }, { value: 'credit', label: 'Credit card' }], canSkip: false }, !d.accountType);
  ask({ id: 'periodFrom', field: 'periodFrom', label: 'Period start', question: 'First day of the statement period?', input: 'date', canSkip: false }, !isIsoDate(d.periodFrom));
  ask({ id: 'periodTo', field: 'periodTo', label: 'Period end', question: 'Last day of the statement period?', input: 'date', canSkip: false }, !isIsoDate(d.periodTo));
  ask({ id: 'opening', field: 'opening', label: d.accountType === 'credit' ? 'Previous balance' : 'Opening balance', question: d.accountType === 'credit' ? 'Previous balance (amount owed at the start)?' : 'Balance at the start of the period?', input: 'money', canSkip: false }, d.openingCents == null);
  ask({ id: 'closing', field: 'closing', label: d.accountType === 'credit' ? 'New balance' : 'Closing balance', question: d.accountType === 'credit' ? 'New balance (amount owed at the end)?' : 'Balance at the end of the period?', input: 'money', canSkip: false }, d.closingCents == null);
  ask({ id: 'rows', field: 'rows', label: 'Transactions', question: 'The reader found no transactions. If the statement lists none, say so.', input: 'choice', options: [], canSkip: true }, d.rows.length === 0);

  // every row needs a date, a description and an amount
  d.rows.forEach((row, i) => {
    const n = i + 1;
    ask({ id: `row.${i}.date`, field: `row.${i}.date`, label: `Row ${n} date`, question: `Row ${n}${row.description ? ` (${row.description})` : ''}: what is the date?`, input: 'date', canSkip: false }, !isIsoDate(row.date));
    ask({ id: `row.${i}.description`, field: `row.${i}.description`, label: `Row ${n} description`, question: `Row ${n}${row.date ? ` on ${row.date}` : ''}: what is the description?`, input: 'text', canSkip: false }, blank(row.description));
    ask({ id: `row.${i}.cents`, field: `row.${i}.cents`, label: `Row ${n} amount`, question: `Row ${n}${row.description ? ` (${row.description})` : ''}: what is the amount? Money going out is negative.`, input: 'money', canSkip: false }, !Number.isInteger(row.cents));
  });

  for (const n of d.corrections ?? []) notes.push(n);
  if (d.truncated) problems.push({ id: 'truncated', text: 'The reader stopped before the end of the statement, so rows at the end are probably missing.' });

  const rowsOk = d.rows.every((r) => Number.isInteger(r.cents));
  const sum = d.rows.reduce((s, r) => s + (r.cents ?? 0), 0);
  if (d.openingCents != null && d.closingCents != null && d.accountType && rowsOk && d.rows.length) {
    const expected = d.accountType === 'credit' ? d.openingCents - sum : d.openingCents + sum;
    const diff = d.closingCents - expected;
    if (diff !== 0) {
      // each row's effect on the expected closing figure; look for a row that explains the gap on its own
      const hints: string[] = [];
      d.rows.forEach((r, i) => {
        const e = d.accountType === 'credit' ? -(r.cents as number) : (r.cents as number);
        const what = `row ${i + 1} (${r.description ?? ''}, ${usd(r.cents as number)})`;
        if (Math.abs(2 * e) === Math.abs(diff) && Math.sign(e) !== Math.sign(diff)) hints.push(`${what} may have the wrong sign`);
        else if (Math.abs(e) === Math.abs(diff)) hints.push(Math.sign(e) === Math.sign(diff) ? `a second charge like ${what} may be missing` : `${what} may be a duplicate or not on this statement`);
      });
      // the file was read twice and these rows came out differently: that is where to look first
      if (d.checkRows?.length) hints.unshift(d.checkRows.slice(0, 3).map((c) => `row ${c.index + 1} (${d.rows[c.index]?.description ?? ''}) was read as ${usd(Math.abs(d.rows[c.index]?.cents ?? 0))} and again as ${usd(Math.abs(c.otherCents))}, so check it against the PDF first`).join('; '));
      // no single row explains it: look for a small group that does, typically a points or rewards table read as charges
      // a block at the end is a strong clue; a scattered group is only offered when something looks like rewards, because among 50 ordinary rows some group of four adds up to almost any small gap by chance
      const rewardsLike = d.rows.some((r) => REWARDS_SECTION.test(r.section ?? '') || /reward|points|cash ?back|redeem/i.test(r.description ?? ''));
      if (!hints.length) {
        const effects = d.rows.map((r) => (d.accountType === 'credit' ? -(r.cents as number) : (r.cents as number)));
        const group = trailingRowsAddingUpTo(effects, -diff) ?? (rewardsLike ? rowsAddingUpTo(effects, -diff) : null);
        if (group) hints.push(`rows ${group.map((i) => i + 1).join(', ').replace(/, (\d+)$/, ' and $1')} (${group.map((i) => d.rows[i].description ?? '').join('; ')}) add up to exactly the gap, so they may be points or rewards lines rather than charges to the card. Remove them if so`);
      }
      // a gap of whole dollars with nothing else to blame is most often one digit misread in one amount
      if (!hints.length && Math.abs(diff) % 100 === 0) hints.push(`the gap is a whole ${usd(Math.abs(diff))}, which is typical of one digit misread in one amount. Compare the amounts with the PDF before changing anything`);
      problems.push({ id: 'reconcile', text: `${d.accountType === 'credit' ? 'Previous balance' : 'Opening balance'} ${usd(d.openingCents)} with the ${d.rows.length} rows gives ${usd(expected)}, but the statement's ${d.accountType === 'credit' ? 'new balance' : 'closing balance'} is ${usd(d.closingCents)}. Off by ${usd(diff)}.${hints.length ? ` Likely: ${hints.slice(0, 3).join('; ')}.` : ' A row is missing, duplicated or has the wrong sign.'}` });
    }
  }
  if (isIsoDate(d.periodFrom) && isIsoDate(d.periodTo)) {
    if (d.periodFrom > d.periodTo) problems.push({ id: 'period', text: `The period starts (${d.periodFrom}) after it ends (${d.periodTo}).` });
    const out = d.rows.filter((r) => isIsoDate(r.date) && (Date.parse(r.date) < Date.parse(d.periodFrom!) - 7 * dayMs || Date.parse(r.date) > Date.parse(d.periodTo!) + 7 * dayMs));
    if (out.length) problems.push({ id: 'outside', text: `${out.length} row${out.length > 1 ? 's are' : ' is'} dated well outside ${d.periodFrom} to ${d.periodTo} (first: ${out[0].date}, ${out[0].description ?? ''}). The year may be wrong.` });
    if (d.periodTo > today) problems.push({ id: 'future', text: `The period ends ${d.periodTo}, which is in the future.` });
  }

  if (d.rewards?.activity.length) {
    const paid = d.rewards.activity.filter((l) => l.amount > 0); const back = d.rewards.activity.filter((l) => l.amount < 0);
    const sum = (ls: RewardsLine[]) => Math.round(ls.reduce((t, l) => t + Math.abs(l.amount), 0) * 100);
    const pts = (ls: RewardsLine[]) => ls.reduce((t, l) => t + Math.abs(l.points ?? 0), 0);
    const n = (v: number) => v.toLocaleString('en-US');
    notes.push(`${d.rewards.activity.length} rewards line${d.rewards.activity.length > 1 ? 's' : ''} found (${paid.length ? `${usd(sum(paid))} paid with points${pts(paid) ? `, ${n(pts(paid))} points` : ''}` : ''}${paid.length && back.length ? '; ' : ''}${back.length ? `${usd(sum(back))} credited back${pts(back) ? `, ${n(pts(back))} points returned` : ''}` : ''}). They are points activity, not charges to the card, so they are kept with the statement and left out of the balance check and the transactions.`);
  }
  if (d.rewards?.summary && d.rewards.availableForRedemption != null && Object.keys(d.rewards.summary).length >= 3) {
    // the label says which way a line goes ("- Points redeemed"), the number may be printed unsigned; "+" lines keep their own sign ("+ Points transferred ... -244")
    const lines = Object.entries(d.rewards.summary).reduce((t, [label, v]) => t + (/^\s*-/.test(label) ? -Math.abs(v) : v), 0);
    if (lines !== d.rewards.availableForRedemption) notes.push(`The printed points summary does not add up: its lines give ${lines.toLocaleString('en-US')} points but it prints ${d.rewards.availableForRedemption.toLocaleString('en-US')} available. Both are kept exactly as printed and nothing is calculated from them.`);
  }

  const acct = resolveAccount(d, ctx.accounts);
  if (d.institution && /^\d{4}$/.test(d.last4 ?? '') && d.accountType && isIsoDate(d.periodFrom) && isIsoDate(d.periodTo)) {
    const target = acct ?? newAccountFor(d);
    if (!acct) notes.push(`This creates a new account: ${target.name}.`);
    else if (acct.type !== d.accountType) problems.push({ id: 'type', text: `${acct.name} is stored as ${acct.type === 'credit' ? 'a credit card' : 'checking'}, but this statement looks like ${d.accountType === 'credit' ? 'a credit card' : 'checking'}.` });
    const same = ctx.statements.filter((s) => s.accountId === target.id && s.periodFrom && s.periodTo && s.periodFrom <= d.periodTo! && s.periodTo >= d.periodFrom!);
    const exact = same.find((s) => s.periodFrom === d.periodFrom && s.periodTo === d.periodTo);
    if (exact) problems.push({ id: 'duplicate', text: `A statement for ${target.name} covering exactly ${d.periodFrom} to ${d.periodTo} is already stored. Rows already stored are not added again; the statement record is updated.`, confirm: 'Continue, update the stored statement' });
    else if (same.length) problems.push({ id: 'overlap', text: `This period overlaps a stored statement for ${target.name} (${same[0].periodFrom} to ${same[0].periodTo}). Rows already stored are not added again.`, confirm: 'Continue, it overlaps on purpose' });

    // rows the ledger already holds, whichever statement or script put them there
    const twins = statementTwins(d, ctx);
    const reread = twins.filter((t) => t.sameId); const reworded = twins.filter((t) => !t.sameId && t.strong); const weak = twins.filter((t) => !t.strong);
    if (reread.length) notes.push(`${reread.length} of ${d.rows.length} rows are already stored exactly as read here and are updated in place.`);
    if (reworded.length) notes.push(`${reworded.length} of ${d.rows.length} rows are already in your ledger under different wording (same account, date, amount and merchant) and will not be added again.`);
    if (twins.length && twins.length === d.rows.length && !weak.length) notes.push('Nothing in this statement is new.');
    if (weak.length && !d.dupRows) {
      const w = d.rows[weak[0].index];
      ask({ id: 'dupRows', field: 'dupRows', label: 'Rows that may already be stored', question: `${weak.length} ${weak.length === 1 ? 'row has' : 'rows have'} the same account, date and amount as ${weak.length === 1 ? 'a stored row' : 'stored rows'} but a different description (first: ${w.date}, ${w.description}, ${usd(w.cents as number)}). Are they the same transactions?`, input: 'choice', options: [{ value: 'skip', label: 'Same transactions, do not add them again' }, { value: 'add', label: 'Different transactions, add them' }], canSkip: false }, true);
    }
  }

  const open = problems.filter((p) => !a.acknowledged.includes(p.id));
  return { gaps, problems: open, notes, ok: gaps.length === 0 && open.length === 0 };
}

export function setStatementField(d: StatementDraft, field: string, text: string): { draft: StatementDraft; error?: string } {
  const t = text.trim();
  const bad = (error: string) => ({ draft: d, error });
  const row = field.match(/^row\.(\d+)\.(date|description|cents)$/);
  if (row) {
    const i = Number(row[1]);
    if (!d.rows[i]) return bad('No such row.');
    let patch: Partial<StatementRow>;
    if (row[2] === 'date') { const v = parseDateISO(t); if (!v) return bad('Use YYYY-MM-DD or MM/DD/YYYY.'); patch = { date: v }; }
    else if (row[2] === 'description') { if (!t) return bad('Enter a description.'); patch = { description: t }; }
    else { const c = parseMoneyCents(t); if (c == null) return bad('Enter an amount like -12.50.'); patch = { cents: c }; }
    return { draft: { ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) } };
  }
  switch (field) {
    case 'institution': return { draft: { ...d, institution: t } };
    case 'product': return { draft: { ...d, product: t } };
    case 'dupRows': return t === 'skip' || t === 'add' ? { draft: { ...d, dupRows: t } } : bad('Choose one.');
    case 'last4': return /^\d{4}$/.test(t) ? { draft: { ...d, last4: t } } : bad('Four digits.');
    case 'accountType': return t === 'checking' || t === 'credit' ? { draft: { ...d, accountType: t } } : bad('Choose one.');
    case 'periodFrom': case 'periodTo': { const v = parseDateISO(t); return v ? { draft: { ...d, [field]: v } } : bad('Use YYYY-MM-DD or MM/DD/YYYY.'); }
    case 'opening': case 'closing': { const c = parseMoneyCents(t); return c == null ? bad('Enter an amount like 1204.55.') : { draft: { ...d, [field === 'opening' ? 'openingCents' : 'closingCents']: c } }; }
    default: return bad(`Unknown field ${field}`);
  }
}

export interface StatementPlan {
  account: Account;
  isNewAccount: boolean;
  statement: StatementRecord;
  txns: Txn[];
  raw: RawRecord[];
  /** existing rows that now have a partner: update their pair_id */
  pairUpdates: { id: string; pairId: string }[];
  /** statement rows not added because the ledger already holds them */
  skipped: { index: number; existingId: string; date?: string; description?: string; cents?: number }[];
}

/** Turn an approved draft into ledger rows. Uses the same classifier and ids as the desktop script, so the two never disagree. */
export function planStatement(d: StatementDraft, ctx: StatementContext & { existing: Txn[] }, file: { name: string; sha256?: string }): StatementPlan {
  const found = resolveAccount(d, ctx.accounts);
  const base = found ?? newAccountFor(d);
  const account: Account = { ...base, coverage: { from: found && found.coverage.from < d.periodFrom! ? found.coverage.from : d.periodFrom!, to: found && found.coverage.to > d.periodTo! ? found.coverage.to : d.periodTo! } };
  const id = `${account.id}:${d.periodFrom}:${d.periodTo}`;
  const label = `${d.institution} ${d.last4} ${d.periodFrom} to ${d.periodTo}`;
  const txns: Txn[] = []; const raw: RawRecord[] = [];
  // a row the ledger already holds under another id is not added again; same-id rows are rewritten in place as before
  const ids = rowIds(d, account.id);
  const twins = found ? findTwins(d.rows, ids, ctx.existing, account.id) : [];
  const skipRows = new Map(twins.filter((t) => !t.sameId && (t.strong || d.dupRows !== 'add')).map((t) => [t.index, t.existingId]));
  const skipped: StatementPlan['skipped'] = [];
  d.rows.forEach((r, i) => {
    if (skipRows.has(i)) { skipped.push({ index: i, existingId: skipRows.get(i)!, date: r.date, description: r.description, cents: r.cents }); return; }
    const cls = classifyRow({ accountId: account.id, date: r.date!, description: r.description!.trim(), cents: r.cents!, source: label }, { type: account.type });
    const t: Txn = { ...cls, id: ids[i] };
    txns.push(t);
    raw.push({ txnId: t.id, statementId: id, lineNo: i + 1, postedDate: r.date, sourceFile: file.name, row: { ...r, readBy: 'app_upload' } });
  });

  const merged = [...ctx.existing.filter((e) => !e.manual).map((e) => ({ ...e })), ...txns];
  const before = new Map(merged.map((t) => [t.id, t.pairId]));
  pairTransfers(merged);
  const newIds = new Set(txns.map((t) => t.id));
  const pairUpdates = merged.filter((t) => !newIds.has(t.id) && t.pairId && t.pairId !== before.get(t.id)).map((t) => ({ id: t.id, pairId: t.pairId! }));
  const withPairs = txns.map((t) => ({ ...t, pairId: merged.find((m) => m.id === t.id)?.pairId }));
  withPairs.forEach((t) => { if (t.pairId === undefined) delete t.pairId; });

  const sum = d.rows.reduce((s, r) => s + (r.cents ?? 0), 0);
  const reconciled = d.openingCents != null && d.closingCents != null && (d.accountType === 'credit' ? d.openingCents - sum : d.openingCents + sum) === d.closingCents;
  const statement: StatementRecord = {
    id, accountId: account.id, institution: d.institution, last4: d.last4, product: d.product ?? (account.type === 'credit' ? 'credit card' : 'checking'), label,
    periodFrom: d.periodFrom, periodTo: d.periodTo, issuedOn: d.issuedOn, dueOn: d.dueOn, openingCents: d.openingCents, closingCents: d.closingCents,
    totals: d.totals, terms: d.rewards && (d.rewards.summary || d.rewards.availableForRedemption != null) ? { ...(d.terms ?? {}), points: { ...(d.rewards.summary ? { lines: d.rewards.summary } : {}), ...(d.rewards.availableForRedemption != null ? { totalAvailableForRedemption: d.rewards.availableForRedemption } : {}) } } : d.terms, reconciled, reconciliation: { rows: d.rows.length, netCents: sum, expectedClosingCents: d.accountType === 'credit' ? d.openingCents! - sum : d.openingCents! + sum },
    sourceFile: file.name, sha256: file.sha256, pages: d.pages, raw: { ...(d.raw ?? {}), ...(d.rewards?.activity.length ? { rewardsActivity: d.rewards.activity, note: 'rewardsActivity lists the points table on the statement; those lines are not in the printed Purchases total' } : {}), readBy: 'app_upload' },
  };
  return { account, isNewAccount: !found, statement, txns: withPairs, raw, pairUpdates, skipped };
}

// ======================================================================
// Reader output -> drafts (dollars in, cents out)
// ======================================================================

const c = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : undefined);
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export interface ReadReceipt {
  merchant?: string; store_address?: string; store_ref?: string; order_ref?: string; date?: string; time?: string; subtotal?: number; tax?: number; tip?: number; discount?: number; total?: number;
  payment_method?: string; card_last4?: string; currency?: string; kind?: string; other_text?: string; unreadable?: string;
  /** part of the order paid with points, a gift card or store credit, dollars, positive */
  paid_other?: number; paid_other_label?: string;
  /** extra charges besides tax and tip: service charge, delivery or bag fee, surcharge, automatic gratuity */
  charges?: { label?: string; amount?: number; rate?: number; type?: string }[];
  /** the item count the receipt prints, e.g. "SOLD ITEM COUNT = 7" */
  item_count?: number;
  /** which model read the file, as the edge function reports it */
  read_by?: string;
  refund?: { total?: number; items?: { item?: string; price?: number }[] };
  items?: { item: string; price: number; qty?: number; unit_price?: number; code?: string; discount?: number }[];
}

/** A card or wallet payment ("Walmart Pay account 9780", "Visa ending 1234") is how the receipt was paid, not points, a gift card or store credit. */
const CARD_TENDER = /walmart pay|apple pay|google pay|samsung pay|paypal|visa|master\s?card|\bmc\b|amex|american express|discover|debit|credit card|\bcard\b|account\s*#?\s*\d{4}|ending\s*\d{4}|\*{2,}\s*\d{4}/i;
const OTHER_TENDER = /point|reward|gift|store credit|certificate|voucher|coupon|loyalty|balance|promo/i;
export const looksLikeCardPayment = (label?: string) => !!label && CARD_TENDER.test(label) && !OTHER_TENDER.test(label);

export function receiptFromRead(o: ReadReceipt, meta: { fileName: string; sha256?: string }): ReceiptRecord {
  // The reader sometimes files the card payment itself as "paid with points or credit". Subtracting it would make every receipt look short,
  // so a payment that names a card or wallet, or that equals the whole total, is the card payment: it is kept as the payment method and not subtracted.
  const otherCents = typeof o.paid_other === 'number' && o.paid_other ? Math.abs(c(o.paid_other)!) : 0;
  const misfiled = otherCents > 0 && (looksLikeCardPayment(o.paid_other_label) || (c(o.total) != null && c(o.total)! > 0 && Math.abs(otherCents - c(o.total)!) <= 1));
  const misfiledNote = misfiled ? `A payment of ${usd(otherCents)}${s(o.paid_other_label) ? ` (${s(o.paid_other_label)})` : ''} was read as paid with points or credit. It looks like the card payment itself, so it was not subtracted from the items. If part of this receipt was really paid with points or a gift card, enter that amount under Check or edit details.` : null;
  return {
    kind: o.kind === 'order_confirmation' || o.kind === 'order_history' ? o.kind : 'store_receipt',
    merchant: s(o.merchant), date: isIsoDate(o.date) ? o.date : (s(o.date) ? parseDateISO(o.date!) ?? undefined : undefined), time: s(o.time),
    totalCents: c(o.total), subtotalCents: c(o.subtotal), taxCents: c(o.tax), tipCents: c(o.tip), discountCents: c(o.discount),
    ...(Array.isArray(o.charges) ? (() => { const cs = o.charges.filter((x) => s(x?.label) && typeof x.amount === 'number' && x.amount).map((x) => ({ label: x.label!.trim(), cents: Math.abs(c(x.amount)!), ...(typeof x.rate === 'number' && x.rate > 0 ? { rate: x.rate } : {}), ...(s(x.type) ? { type: x.type!.trim().toLowerCase() } : {}) })); return cs.length ? { charges: cs } : {}; })() : {}),
    ...(typeof o.item_count === 'number' && Number.isInteger(o.item_count) && o.item_count > 0 ? { itemCount: o.item_count } : {}),
    ...(otherCents && !misfiled ? { paidOtherCents: otherCents, paidOtherLabel: s(o.paid_other_label) } : {}),
    ...(misfiledNote ? { corrections: [misfiledNote] } : {}),
    ...(typeof o.refund?.total === 'number' && o.refund.total ? { refundCents: Math.abs(c(o.refund.total)!), refundedLines: (o.refund.items ?? []).filter((i) => s(i.item) && typeof i.price === 'number').map((i) => ({ item: i.item!.trim(), cents: Math.abs(c(i.price)!) })) } : {}),
    currency: s(o.currency) ?? 'USD', paymentMethod: s(o.payment_method) ?? (misfiled ? s(o.paid_other_label) : undefined), cardLast4: s(o.card_last4)?.replace(/\D/g, '').slice(-4) || undefined,
    storeAddress: s(o.store_address), storeRef: s(o.store_ref), orderRef: s(o.order_ref),
    lines: (o.items ?? []).filter((i) => s(i.item) && typeof i.price === 'number').map((i) => ({
      // the reader sometimes puts a weight (1.64 lb) in the quantity field: a whole number is a count, anything else is a weight
      item: i.item.trim(), cents: c(i.price)!, ...(Number.isInteger(i.qty) && (i.qty as number) > 0 ? { qty: i.qty } : {}),
      ...(typeof i.qty === 'number' && i.qty > 0 && !Number.isInteger(i.qty) ? { weight: i.qty } : {}), unitCents: c(i.unit_price), code: s(i.code), discountCents: c(i.discount),
    })),
    sourceFile: meta.fileName, sha256: meta.sha256, origin: 'app_upload', capturedAt: new Date().toISOString(), readBy: s(o.read_by),
    raw: { reader: o, ...(o.other_text ? { otherText: o.other_text } : {}) },
  };
}

export interface ReadStatement {
  institution?: string; product?: string; last4?: string; account_type?: string;
  period_from?: string; period_to?: string; statement_date?: string; due_date?: string;
  opening_balance?: number; closing_balance?: number;
  totals?: Record<string, number>; terms?: Record<string, unknown>; other_text?: string; unreadable?: string; pages?: number;
  rows?: { date?: string; description?: string; amount?: number; flow?: string; section?: string }[];
  /** points or cash-back tables: kept apart from rows */
  rewards?: { summary?: { label?: string; points?: number }[]; points_available?: number; activity?: { date?: string; description?: string; amount?: number; points?: number; type?: string }[] };
  truncated?: boolean;
  read_by?: string;
}

const REWARDS_SECTION = /redemption|points|rewards/i;

/**
 * Points and cash-back tables sit on the same pages as the charges but never touch the balance owed. The reader is told to report them
 * apart; if it still lists some as rows, they are taken out here: rows under a points-style heading, and rows that repeat a reported rewards line.
 */
function splitRewards(o: ReadStatement, rows: StatementRow[]): { rows: StatementRow[]; rewards?: RewardsInfo } {
  const given: RewardsLine[] = (o.rewards?.activity ?? []).filter((a) => typeof a.amount === 'number' && Number.isFinite(a.amount)).map((a) => ({
    section: a.type === 'return' || (a.amount as number) < 0 ? 'return' : 'purchase_or_redemption', date: isIsoDate(a.date) ? a.date : undefined, description: s(a.description) ?? '',
    amount: Math.round((a.amount as number) * 100) / 100, points: typeof a.points === 'number' && Number.isFinite(a.points) ? a.points : undefined,
  }));
  const keep: StatementRow[] = []; const moved: RewardsLine[] = [];
  for (const r of rows) {
    const asPrinted = Number.isInteger(r.cents) ? -(r.cents as number) / 100 : null;   // a charge is positive, a credit negative
    const repeats = asPrinted != null && given.some((g) => g.date === r.date && Math.round(g.amount * 100) === Math.round(asPrinted * 100));
    if (repeats) continue;
    if (r.section && REWARDS_SECTION.test(r.section) && asPrinted != null) { moved.push({ section: asPrinted < 0 ? 'return' : 'purchase_or_redemption', date: r.date, description: r.description ?? '', amount: asPrinted }); continue; }
    keep.push(r);
  }
  const activity = [...given, ...moved];
  const summary = o.rewards?.summary?.length ? Object.fromEntries(o.rewards.summary.filter((l) => s(l.label) && typeof l.points === 'number').map((l) => [l.label!.trim(), l.points as number])) : undefined;
  const available = typeof o.rewards?.points_available === 'number' ? o.rewards.points_available : undefined;
  if (!activity.length && !summary && available == null) return { rows: keep };
  return { rows: keep, rewards: { activity, ...(summary ? { summary } : {}), ...(available != null ? { availableForRedemption: available } : {}) } };
}

export function statementFromRead(o: ReadStatement): StatementDraft {
  const t = (o.account_type ?? '').toLowerCase();
  // lines printed as $0.00 ("Interest charged on purchases 0.00") move no money: they are kept with the statement, not added as transactions
  const isZero = (r: { amount?: number }) => typeof r.amount === 'number' && r.amount === 0;
  const zero = (o.rows ?? []).filter(isZero);
  const split = splitRewards(o, (o.rows ?? []).filter((r) => !isZero(r)).map((r) => ({
    date: isIsoDate(r.date) ? r.date : undefined, description: s(r.description),
    cents: typeof r.amount === 'number' && Number.isFinite(r.amount) ? Math.round(Math.abs(r.amount) * 100) * (r.flow === 'in' ? 1 : -1) : undefined,
    section: s(r.section),
  })));
  return {
    institution: s(o.institution), product: s(o.product), last4: s(o.last4)?.replace(/\D/g, '').slice(-4) || undefined,
    accountType: /credit|card/.test(t) ? 'credit' : /check|sav|deposit|bank/.test(t) ? 'checking' : undefined,
    periodFrom: isIsoDate(o.period_from) ? o.period_from : undefined, periodTo: isIsoDate(o.period_to) ? o.period_to : undefined,
    issuedOn: isIsoDate(o.statement_date) ? o.statement_date : undefined, dueOn: isIsoDate(o.due_date) ? o.due_date : undefined,
    openingCents: c(o.opening_balance), closingCents: c(o.closing_balance),
    rows: split.rows, ...(split.rewards ? { rewards: split.rewards } : {}),
    totals: o.totals ? Object.fromEntries(Object.entries(o.totals).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round(v * 100)])) : undefined,
    terms: o.terms, pages: typeof o.pages === 'number' ? o.pages : undefined, truncated: !!o.truncated, readBy: s(o.read_by),
    raw: { reader: o, ...(o.other_text ? { otherText: o.other_text } : {}), ...(zero.length ? { zeroAmountLines: zero.map((r) => ({ date: r.date, description: r.description, section: r.section })) } : {}) },
    ...(zero.length ? { corrections: [`${zero.length} line${zero.length > 1 ? 's' : ''} printed as $0.00 (${[...new Set(zero.map((r) => r.description ?? 'no description'))].slice(0, 4).join('; ')}) ${zero.length > 1 ? 'are' : 'is'} kept with the statement and not added as transactions.`] } : {}),
  };
}

// ======================================================================
// Reading a statement twice
// ======================================================================

/** printed balance minus the balance the rows give, in cents. null when the draft cannot be checked yet. 0 = adds up. */
export function statementGap(d: StatementDraft, rows: StatementRow[] = d.rows): number | null {
  if (d.openingCents == null || d.closingCents == null || !d.accountType || !rows.length || !rows.every((r) => Number.isInteger(r.cents))) return null;
  const sum = rows.reduce((t, r) => t + (r.cents as number), 0);
  return d.closingCents - (d.accountType === 'credit' ? d.openingCents - sum : d.openingCents + sum);
}

const textKey = (t?: string) => (t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Rows that carry the same date and description in both readings but a different amount. Identical rows are paired first, so two lines with one description are not mixed up. */
function rowsReadDifferently(a: StatementRow[], b: StatementRow[]): { index: number; otherCents: number }[] {
  const left = new Set(a.map((_, i) => i)); const right = new Set(b.map((_, i) => i));
  const pair = (withCents: boolean) => {
    for (const i of [...left]) {
      const j = [...right].find((k) => a[i].date === b[k].date && textKey(a[i].description) === textKey(b[k].description) && (!withCents || a[i].cents === b[k].cents));
      if (j != null) { left.delete(i); right.delete(j); if (!withCents && Number.isInteger(b[j].cents) && a[i].cents !== b[j].cents) diffs.push({ index: i, otherCents: b[j].cents as number }); }
    }
  };
  const diffs: { index: number; otherCents: number }[] = [];
  pair(true); pair(false);
  return diffs.sort((x, y) => x.index - y.index);
}

/**
 * The same file read a second time, after the first reading failed the balance check. A misread digit is the usual cause and it rarely repeats,
 * so the printed balance can pick the right reading: a second reading that adds up is kept, and so is a first reading with the one or two
 * amounts replaced that make it add up. Anything else keeps the first reading and records which rows came out differently.
 */
export function settleReads(first: StatementDraft, second: StatementDraft): StatementDraft {
  if (statementGap(second) === 0) return { ...second, corrections: ['The first reading of this file did not add up to the printed balance. A second reading did, so that one is kept.'] };
  const gap = statementGap(first);
  if (gap == null || gap === 0) return first;
  const diffs = rowsReadDifferently(first.rows, second.rows);
  if (!diffs.length) return first;
  const swapped = (pick: number[]) => first.rows.map((r, i) => { const d = diffs.find((x) => x.index === i); return d && pick.includes(i) ? { ...r, cents: d.otherCents } : r; });
  const fixes: number[][] = [];
  const small = diffs.slice(0, 12);
  for (let i = 0; i < small.length; i++) {
    if (statementGap(first, swapped([small[i].index])) === 0) fixes.push([small[i].index]);
    for (let j = i + 1; j < small.length; j++) if (statementGap(first, swapped([small[i].index, small[j].index])) === 0) fixes.push([small[i].index, small[j].index]);
  }
  const singles = fixes.filter((f) => f.length === 1);
  const chosen = singles.length === 1 ? singles[0] : singles.length === 0 && fixes.length === 1 ? fixes[0] : null;
  if (chosen) {
    const rows = swapped(chosen);
    const notes = chosen.map((i) => `Row ${i + 1} (${first.rows[i].description ?? ''}) was read as ${usd(Math.abs(first.rows[i].cents as number))} the first time and ${usd(Math.abs(rows[i].cents as number))} the second time. ${usd(Math.abs(rows[i].cents as number))} makes the statement add up to its printed balance, so that is what is kept. Check it against the PDF if you want to be sure.`);
    return { ...first, rows, corrections: notes };
  }
  return { ...first, checkRows: diffs };
}

// ======================================================================
// Reading a receipt twice
// ======================================================================

const AMOUNT_CHECKS = new Set(['sum', 'subtotal', 'count']);
/** The checks that compare printed amounts with each other (items against the subtotal, the total and the printed item count). 0 = they all agree or cannot be checked. */
export const receiptMisfits = (r: ReceiptRecord): number => analyseReceipt(r, noAnswers(), '2100-01-01').problems.filter((p) => AMOUNT_CHECKS.has(p.id)).length;

/**
 * A receipt read a second time after the first reading failed its own checks. The printed subtotal, total and item count choose between the two
 * readings: one that agrees with them replaces one that does not. If neither agrees, the first stays and nothing is guessed.
 */
export function settleReceiptReads(first: ReceiptRecord, second: ReceiptRecord): ReceiptRecord {
  const a = receiptMisfits(first); const b = receiptMisfits(second);
  if (a === 0 || b >= a) return first;
  const who = second.readBy ? ` (${second.readBy})` : '';
  return { ...second, corrections: [b === 0 ? `The first reading of this receipt did not add up to its printed subtotal, total or item count. A second reading${who} did, so that one is kept. Check the prices against the image if you want to be sure.` : `The first reading of this receipt disagreed with its printed amounts in ${a} places. A second reading${who} disagrees in ${b}, so that one is kept, but it still does not add up.`] };
}

export interface ReceiptDiff {
  /** what the new reading changes, in plain words. Empty when it says the same thing. */
  lines: string[];
  /** how many of the amount checks (items vs subtotal, total, item count) disagree with the printed figures, before and after */
  before: number; after: number;
}

/** Compare the receipt on screen with a new reading of the same file. Items are paired by what they say, then by price, so a different spelling of one line is not reported as a change. */
const chargesText = (r: ReceiptRecord) => ((r.charges ?? []).map((x) => `${x.label} ${usd(x.cents)}`).join(', ') || 'none');

export function diffReceipts(a: ReceiptRecord, b: ReceiptRecord): ReceiptDiff {
  const lines: string[] = [];
  const m = (v?: number) => (v == null ? 'missing' : usd(v));
  const head: [string, string, string][] = [['Store', a.merchant ?? 'missing', b.merchant ?? 'missing'], ['Date', a.date ?? 'missing', b.date ?? 'missing'], ['Total paid', m(a.totalCents), m(b.totalCents)], ['Subtotal', m(a.subtotalCents), m(b.subtotalCents)],
    ['Sales tax', m(a.taxCents), m(b.taxCents)], ['Tip', m(a.tipCents), m(b.tipCents)], ['Extra charges', chargesText(a), chargesText(b)], ['Paid with points or credit', m(a.paidOtherCents), m(b.paidOtherCents)], ['Refund', m(a.refundCents), m(b.refundCents)], ['Items read', String(a.lines.length), String(b.lines.length)]];
  for (const [label, x, y] of head) if (x !== y) lines.push(`${label}: ${x} → ${y}`);
  const left = new Set(a.lines.map((_, i) => i)); const right = new Set(b.lines.map((_, i) => i));
  const pair = (match: (x: ReceiptRecord['lines'][number], y: ReceiptRecord['lines'][number]) => boolean, onPair?: (i: number, j: number) => void) => {
    for (const i of [...left]) { const j = [...right].find((k) => match(a.lines[i], b.lines[k])); if (j != null) { left.delete(i); right.delete(j); onPair?.(i, j); } }
  };
  // lines that say much the same thing (the same words, or one respelled by the reader) are the same item: only a different price is a change
  const bigWords = (t: string) => t.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4);
  const similar = (x: string, y: string) => textKey(x) === textKey(y) || bigWords(x).some((w) => bigWords(y).includes(w));
  pair((x, y) => textKey(x.item) === textKey(y.item) && x.cents === y.cents);
  pair((x, y) => similar(x.item, y.item) && x.cents === y.cents);
  pair((x, y) => similar(x.item, y.item), (i, j) => lines.push(`${a.lines[i].item}: ${usd(a.lines[i].cents)} → ${usd(b.lines[j].cents)}`));
  for (const i of [...left].slice(0, 10)) lines.push(`Not in the new reading: ${a.lines[i].item} ${usd(a.lines[i].cents)}`);
  for (const j of [...right].slice(0, 10)) lines.push(`New reading adds: ${b.lines[j].item} ${usd(b.lines[j].cents)}`);
  return { lines, before: receiptMisfits(a), after: receiptMisfits(b) };
}

/** The receipt on screen as numbered text. It goes back to the reader with the person's note, so "item 3" in the note means the line they saw. */
export function receiptAsText(r: ReceiptRecord): string {
  const m = (v?: number) => (v == null ? '?' : usd(v));
  const head = [`store ${r.merchant ?? '?'}`, `date ${r.date ?? '?'}`, `subtotal ${m(r.subtotalCents)}`, `tax ${m(r.taxCents)}`, ...(r.tipCents ? [`tip ${m(r.tipCents)}`] : []),
    ...(r.charges ?? []).map((c) => `${c.label} ${usd(c.cents)}`), ...(r.paidOtherCents ? [`paid with points or credit ${usd(r.paidOtherCents)}`] : []), `total ${m(r.totalCents)}`];
  return [head.join('; '), ...r.lines.map((l, i) => `${i + 1}. ${l.item} | ${usd(l.cents)}`)].join('\n');
}

/** The person chose the new reading of a receipt. Their earlier answer about a duplicate carries over; everything else is the new reading. */
export function acceptReceiptReading(current: ReceiptRecord, next: ReceiptRecord, hint?: string): ReceiptRecord {
  return { ...next, ...(current.dup ? { dup: current.dup } : {}), corrections: [...(next.corrections ?? []), `Read again at your request${next.readBy ? ` (${next.readBy})` : ''}${hint ? ` with your note “${hint}”` : ''}. The new reading replaced the earlier one. Check it against the original.`] };
}

// ======================================================================
// Telling the reader what looks wrong and reading again
// ======================================================================

/** The longest note a person can send with a re-read. */
export const MAX_HINT = 600;

const rowLine = (r: StatementRow) => `${r.date ?? 'no date'} | ${r.description ?? ''} | ${Number.isInteger(r.cents) ? `${usd(Math.abs(r.cents as number))} ${(r.cents as number) < 0 ? 'out' : 'in'}` : 'no amount'}`;

/** The current reading as numbered text. It goes back to the reader with the person's note, so "row 7" in the note means the row they saw on screen. */
export function readingAsText(d: StatementDraft): string {
  const head = [`period ${d.periodFrom ?? '?'} to ${d.periodTo ?? '?'}`, `${d.accountType === 'credit' ? 'previous balance' : 'opening balance'} ${d.openingCents != null ? usd(d.openingCents) : '?'}`, `${d.accountType === 'credit' ? 'new balance' : 'closing balance'} ${d.closingCents != null ? usd(d.closingCents) : '?'}`];
  return [head.join('; '), ...d.rows.map((r, i) => `${i + 1}. ${rowLine(r)}`)].join('\n');
}

export interface ReadingDiff {
  /** what the new reading changes, in plain words. Empty when it says the same thing. */
  lines: string[];
  /** printed balance minus what the rows give, before and after. 0 = adds up, null = cannot be checked */
  gapBefore: number | null; gapAfter: number | null;
}

/** Compare the reading on screen with a new one. Rows are paired by what they say, so a date that changed on every row is reported once, not twelve times. */
export function diffReadings(a: StatementDraft, b: StatementDraft): ReadingDiff {
  const lines: string[] = [];
  const head: [string, unknown, unknown][] = [['Bank or issuer', a.institution, b.institution], ['Account last 4', a.last4, b.last4], ['Account type', a.accountType, b.accountType], ['Period start', a.periodFrom, b.periodFrom], ['Period end', a.periodTo, b.periodTo],
    ['Opening / previous balance', a.openingCents != null ? usd(a.openingCents) : undefined, b.openingCents != null ? usd(b.openingCents) : undefined], ['Closing / new balance', a.closingCents != null ? usd(a.closingCents) : undefined, b.closingCents != null ? usd(b.closingCents) : undefined]];
  for (const [label, x, y] of head) if (x !== y) lines.push(`${label}: ${x ?? 'missing'} → ${y ?? 'missing'}`);

  const left = new Set(a.rows.map((_, i) => i)); const right = new Set(b.rows.map((_, i) => i));
  const dateMoves: string[] = []; const amountMoves: string[] = [];
  const pair = (match: (x: StatementRow, y: StatementRow) => boolean, onPair?: (i: number, j: number) => void) => {
    for (const i of [...left]) {
      const j = [...right].find((k) => match(a.rows[i], b.rows[k]));
      if (j != null) { left.delete(i); right.delete(j); onPair?.(i, j); }
    }
  };
  const same = (x: StatementRow, y: StatementRow) => textKey(x.description) === textKey(y.description);
  pair((x, y) => x.date === y.date && same(x, y) && x.cents === y.cents);
  pair((x, y) => same(x, y) && x.cents === y.cents, (i, j) => dateMoves.push(`row ${i + 1} (${a.rows[i].description ?? ''}) ${a.rows[i].date ?? 'no date'} → ${b.rows[j].date ?? 'no date'}`));
  pair((x, y) => x.date === y.date && same(x, y), (i, j) => amountMoves.push(`Row ${i + 1} (${a.rows[i].description ?? ''}): ${Number.isInteger(a.rows[i].cents) ? usd(Math.abs(a.rows[i].cents as number)) : 'no amount'} → ${Number.isInteger(b.rows[j].cents) ? usd(Math.abs(b.rows[j].cents as number)) : 'no amount'}`));
  if (dateMoves.length) lines.push(dateMoves.length <= 3 ? `Date changed on ${dateMoves.join('; ')}` : `Date changed on ${dateMoves.length} rows, for example ${dateMoves[0]}`);
  lines.push(...amountMoves);
  for (const i of [...left].slice(0, 8)) lines.push(`Row ${i + 1} (${rowLine(a.rows[i])}) is not in the new reading`);
  for (const j of [...right].slice(0, 8)) lines.push(`New reading adds: ${rowLine(b.rows[j])}`);
  if (left.size > 8 || right.size > 8) lines.push('More rows differ than are listed here.');
  return { lines, gapBefore: statementGap(a), gapAfter: statementGap(b) };
}

/** The person chose the new reading: it replaces the old one, and the note they gave is kept on the statement and shown as a correction. */
export function acceptReading(next: StatementDraft, hints: string[]): StatementDraft {
  const note = `Read again at your request${hints.length ? ` (${hints.map((h) => `“${h}”`).join(', ')})` : ''}. The new reading is what the reader returned; check it against the PDF.`;
  return { ...next, checkRows: undefined, corrections: [...(next.corrections ?? []), note], raw: { ...(next.raw ?? {}), ...(hints.length ? { readerNotes: hints } : {}) } };
}

// ======================================================================
// Small corrections the review screen offers
// ======================================================================

/** the text shown in an edit box for a receipt field */
export function receiptFieldText(r: ReceiptRecord, field: string): string {
  const m = (v?: number) => (v == null ? '' : (v / 100).toFixed(2));
  switch (field) {
    case 'merchant': return r.merchant ?? '';
    case 'date': return r.date ?? '';
    case 'time': return r.time ?? '';
    case 'total': return m(r.totalCents);
    case 'subtotal': return m(r.subtotalCents);
    case 'tax': return m(r.taxCents);
    case 'tip': return m(r.tipCents);
    case 'charges': return (r.charges ?? []).map((x) => `${x.label} ${(x.cents / 100).toFixed(2)}`).join('\n');
    case 'paidOther': return m(r.paidOtherCents);
    case 'refundTotal': return m(r.refundCents);
    case 'paymentMethod': return r.paymentMethod ?? '';
    case 'cardLast4': return r.cardLast4 ?? '';
    case 'storeAddress': return r.storeAddress ?? '';
    case 'storeRef': return r.storeRef ?? '';
    case 'orderRef': return r.orderRef ?? '';
    case 'lines': return linesToText(r.lines);
    default: return '';
  }
}

export function statementFieldText(d: StatementDraft, field: string): string {
  const m = (v?: number) => (v == null ? '' : (v / 100).toFixed(2));
  switch (field) {
    case 'institution': return d.institution ?? '';
    case 'last4': return d.last4 ?? '';
    case 'accountType': return d.accountType ?? '';
    case 'periodFrom': return d.periodFrom ?? '';
    case 'periodTo': return d.periodTo ?? '';
    case 'opening': return m(d.openingCents);
    case 'closing': return m(d.closingCents);
    default: return '';
  }
}

export const flipRow = (d: StatementDraft, i: number): StatementDraft => ({ ...d, rows: d.rows.map((r, j) => (j === i && Number.isInteger(r.cents) ? { ...r, cents: -(r.cents as number) } : r)) });
export const removeRow = (d: StatementDraft, i: number): StatementDraft => ({ ...d, rows: d.rows.filter((_, j) => j !== i) });
export function addRow(d: StatementDraft, date: string, description: string, amount: string): { draft: StatementDraft; error?: string } {
  const iso = parseDateISO(date); const cents = parseMoneyCents(amount);
  if (!iso) return { draft: d, error: 'Use YYYY-MM-DD or MM/DD/YYYY for the date.' };
  if (!description.trim()) return { draft: d, error: 'Enter a description.' };
  if (cents == null) return { draft: d, error: 'Enter an amount like -12.50 (money out is negative).' };
  return { draft: { ...d, rows: [...d.rows, { date: iso, description: description.trim(), cents }].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')) } };
}
