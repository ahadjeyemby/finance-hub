// Turning what the pay slip reader returned into the pay record form. Pure TypeScript. The reading is a starting point for the person to check:
// nothing here adjusts a figure to make it fit, so a slip that does not add up shows its gap in the form (see income.ts recordIssues).
import type { IncomeSource, PayRecord } from './income';

export interface ReadPayslip {
  employer?: string; pay_date?: string; period_from?: string; period_to?: string;
  gross?: number; net?: number;
  earnings?: { label?: string; amount?: number }[];
  taxes?: { label?: string; amount?: number }[];
  deductions?: { label?: string; amount?: number; group?: string }[];
  deposits?: { last4?: string; amount?: number }[];
  other_text?: string; unreadable?: string; read_by?: string;
}

export interface FormLine { label: string; amount: string; group?: 'insurance' | 'retirement' | 'other'; last4?: string }
export interface PayslipDraft {
  employer: string; date: string; periodFrom: string; periodTo: string; gross: string; net: string;
  taxes: FormLine[]; deductions: FormLine[]; deposits: FormLine[];
  /** a source whose name matches the employer, when exactly one does */
  sourceId: string | null;
  /** things to look at before saving */
  notes: string[];
  readBy?: string;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
/** dollars as the form shows them, always positive: a slip that prints taxes with a minus sign still gives a positive amount */
const dollars = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) && n !== 0 ? Math.abs(n).toFixed(2) : '');

/** The kind of deduction, from its name. The reader's own guess is used only when the name says nothing. */
export function deductionGroup(label: string, guess?: string): 'insurance' | 'retirement' | 'other' {
  const l = label.toLowerCase();
  if (/\b(med|medical|dental|vision|health|insur|hsa|fsa|premium|life|disab)/.test(l)) return 'insurance';
  if (/\b(401|403|457|retire|pension|roth|ira)\b|401k|403b/.test(l)) return 'retirement';
  return guess === 'insurance' || guess === 'retirement' ? guess : 'other';
}

const amt = (x?: { amount?: number } | null): boolean => !!x && typeof x.amount === 'number' && Number.isFinite(x.amount) && x.amount !== 0;
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);

export function draftFromRead(read: ReadPayslip, sources: IncomeSource[] = []): PayslipDraft {
  const notes: string[] = [];
  const taxes: FormLine[] = (read.taxes ?? []).filter(amt).map((t) => ({ label: (t.label ?? '').trim(), amount: dollars(t.amount) }));
  const deductions: FormLine[] = (read.deductions ?? []).filter(amt).map((d) => ({ label: (d.label ?? '').trim(), amount: dollars(d.amount), group: deductionGroup(d.label ?? '', d.group) }));
  const deposits: FormLine[] = (read.deposits ?? []).filter(amt).map((d) => ({ label: '', amount: dollars(d.amount), last4: (d.last4 ?? '').replace(/\D/g, '').slice(-4) }));
  if (!isDate(read.pay_date)) notes.push('The pay date was not read. Enter it from the slip.');
  if (typeof read.gross !== 'number') notes.push('Gross pay was not read. Enter it from the slip.');
  if (typeof read.net !== 'number') notes.push('Net pay was not read. Enter it from the slip.');
  if (!taxes.length) notes.push('No taxes were read. If the slip lists any, add them.');
  if (!deposits.length) notes.push('No deposit was read. Add the accounts it was sent to so the app can find them on your statements, or leave it empty.');
  if (read.unreadable?.trim()) notes.push(`The reader could not read: ${read.unreadable.trim()}`);
  const emp = (read.employer ?? '').trim();
  const ew = words(emp);
  const hits = ew.length ? sources.filter((s) => { const sw = words(s.name); return sw.some((w) => ew.includes(w)); }) : [];
  return {
    employer: emp, date: isDate(read.pay_date) ? read.pay_date : '', periodFrom: isDate(read.period_from) ? read.period_from : '', periodTo: isDate(read.period_to) ? read.period_to : '',
    gross: dollars(read.gross), net: dollars(read.net), taxes, deductions, deposits, sourceId: hits.length === 1 ? hits[0].id : null, notes, readBy: read.read_by,
  };
}

/** A note to keep on the saved record: how it came to be. */
export const provenance = (readBy?: string, fileName?: string) => `Read${readBy ? ` by ${readBy}` : ''}${fileName ? ` from ${fileName}` : ''} and checked by hand.`;

export type { PayRecord };
