// The cash purchase form: what the screen holds while the person fills it in or edits an entry, and the checks on it. Pure TypeScript.
// Replaces the one-question-at-a-time chat with a form in sections (tabs) that can be visited in any order and revisited, so the same form
// serves for a new entry and for changing one that was saved.
import { cashToTxn } from './answers';
import { parseDateISO, parseMoneyCents } from './intake';
import { parseLines, suggestCategory } from './questions';
import type { CashDraft } from './questions';
import type { Txn } from './types';

export interface CashForm {
  amount: string;
  merchant: string;
  /** YYYY-MM-DD (MM/DD/YYYY is accepted and converted) */
  date: string;
  what: string;
  category: string;
  business: boolean;
  oneOff: boolean;
  /** one "item price" per line, or separated by commas; optional */
  items: string;
}

export type CashTab = 'amount' | 'details' | 'items' | 'review';
export const CASH_TABS: { id: CashTab; label: string; help: string }[] = [
  { id: 'amount', label: 'Amount', help: 'How much, to whom, and when.' },
  { id: 'details', label: 'Details', help: 'What it was for, its category, and whether it was business.' },
  { id: 'items', label: 'Items', help: 'Optional: split a mixed purchase into what was bought.' },
  { id: 'review', label: 'Review', help: 'Check everything, then save.' },
];

export type CashField = 'amount' | 'merchant' | 'date' | 'category' | 'items';
export const emptyCashForm = (today: string): CashForm => ({ amount: '', merchant: '', date: today, what: '', category: '', business: false, oneOff: false, items: '' });

const dollarsNum = (text: string): number | null => { const c = parseMoneyCents(text); return c != null && c > 0 ? c / 100 : null; };

export interface CashCheck { errors: Partial<Record<CashField, string>>; ok: boolean; /** parsed items, when they were readable */ lines: { item: string; amount: number }[]; remainderCents: number }

/** What is wrong with the form, field by field, in plain words. Nothing is changed to make it fit. */
export function checkCash(f: CashForm): CashCheck {
  const errors: CashCheck['errors'] = {};
  const amount = dollarsNum(f.amount);
  if (amount == null) errors.amount = f.amount.trim() ? 'Enter an amount above zero, like 12.50.' : 'Enter how much was paid.';
  if (!f.merchant.trim()) errors.merchant = 'Enter who was paid: a store, a person or a service.';
  if (!parseDateISO(f.date)) errors.date = 'Use YYYY-MM-DD, or MM/DD/YYYY.';
  if (!f.category) errors.category = 'Choose a category.';
  let lines: { item: string; amount: number }[] = []; let remainderCents = 0;
  if (f.items.trim()) {
    const p = parseLines(f.items);
    if (p.bad.length) errors.items = `Could not read: ${p.bad.join(', ')}. Use "item price", one per line.`;
    else {
      lines = p.lines;
      const sum = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100);
      if (amount != null) {
        const total = Math.round(amount * 100);
        if (sum > total) errors.items = `The items add up to $${(sum / 100).toFixed(2)}, more than the $${amount.toFixed(2)} paid. Check the prices.`;
        else remainderCents = total - sum;
      }
    }
  }
  return { errors, ok: !Object.keys(errors).length, lines, remainderCents };
}

/** Where each section stands, for the tabs: done, still to fill in, has a problem, or optional and left empty. */
export function tabStatus(f: CashForm): Record<CashTab, 'done' | 'todo' | 'error' | 'optional'> {
  const e = checkCash(f).errors;
  const touched = (v: string) => v.trim() !== '';
  return {
    amount: e.amount || e.merchant || e.date ? (touched(f.amount) || touched(f.merchant) ? 'error' : 'todo') : 'done',
    details: e.category ? 'todo' : 'done',
    items: e.items ? 'error' : f.items.trim() ? 'done' : 'optional',
    review: checkCash(f).ok ? 'done' : 'todo',
  };
}

/** The first section that still needs something, or 'review' when all is in. */
export const firstOpenTab = (f: CashForm): CashTab => { const s = tabStatus(f); return s.amount !== 'done' ? 'amount' : s.details !== 'done' ? 'details' : s.items === 'error' ? 'items' : 'review'; };

/** A category to offer from the words typed so far. */
export const suggestedCategory = (f: CashForm): string | undefined => suggestCategory(`${f.merchant} ${f.what}`) ?? undefined;

export function formToDraft(f: CashForm): CashDraft {
  const c = checkCash(f);
  return {
    amount: dollarsNum(f.amount) ?? 0, merchant: f.merchant.trim(), what: f.what.trim() || undefined, category: f.category, date: parseDateISO(f.date) ?? f.date,
    business: f.business, oneOff: f.oneOff, lines: c.lines.length ? c.lines : undefined, splitAsked: true,
  };
}

/** The ledger row for the form. When editing, the entry keeps its id, its creation time and anything linked to it. */
export function buildCash(f: CashForm, today: string, now: number = Date.now(), existing?: Txn): Txn {
  const t = cashToTxn(formToDraft(f), today, now);
  if (!existing) return t;
  return { ...t, id: existing.id, createdAt: existing.createdAt ?? t.createdAt, editedAt: new Date(now).toISOString(), receiptId: existing.receiptId, source: existing.source };
}

/** The form for an entry already saved. The "Other (not itemised)" line is left out: it is worked out again from the amount. */
export function txnToForm(t: Txn): CashForm {
  const items = (t.lines ?? []).filter((l) => l.item !== 'Other (not itemised)').map((l) => `${l.item} ${(l.cents / 100).toFixed(2)}`).join('\n');
  return {
    amount: (Math.abs(t.cents) / 100).toFixed(2), merchant: t.merchant, date: t.date, what: t.note ?? t.description ?? '', category: String(t.category ?? ''),
    business: !!t.business, oneOff: !!t.oneOff, items,
  };
}

/** Did the person change anything from what was saved? */
export const cashChanged = (a: CashForm, b: CashForm): boolean => JSON.stringify(a) !== JSON.stringify(b);
