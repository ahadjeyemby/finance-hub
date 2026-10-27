import { categoryLabel } from './categories';
import { completeMonths, coveredDays } from './coverage';
import { addMonths, daysInMonth, monthOf } from './dates';
import type { Ctx } from './queries';
import { normKey, summarizeRecurring } from './recurring';
import type { CategoryId, Txn } from './types';

export { completeMonths } from './coverage';

export interface RecurringItem { merchant: string; category?: CategoryId; typical: number; months: number }
export interface Forecast {
  month: string;
  total: number; low: number; high: number;
  recurringTotal: number; variableTotal: number;
  recurring: RecurringItem[];
  variableByCategory: { category: CategoryId; label: string; estimate: number }[];
  /** left out of the forecast: confirmed one-offs, and single charges of $1,000 or more nobody has answered for yet (confirmed false) */
  oneOffsExcluded: { merchant: string; date: string; cents: number; confirmed: boolean }[];
  basisMonths: string[];
  confidence: 'low' | 'medium' | 'high';
  /** plain-language caveat shown next to the number */
  caveat: string;
  /** when the target month already has a week of statements, how the estimate blends it in */
  pace?: { spentSoFar: number; daysElapsed: number; paceTotal: number; weight: number };
}

const isSpend = (t: Txn) => t.kind === 'spend' || t.kind === 'fee' || t.kind === 'refund';

/** A one-off is left out of averages and forecasts: one the person marked, or a single charge of $1,000 or more they have not said repeats. */
export const isOneOff = (t: Txn) => t.oneOff === true || (t.cents <= -100000 && t.oneOff !== false);

export function forecastMonth(ctx: Ctx, target: string, asOf: string): Forecast {
  const basis = completeMonths(ctx, '2000-01-01', addMonths(target, -1)).filter((m) => m < target);
  const personal = ctx.txns.filter((t) => !t.business);
  const spend = personal.filter((t) => isSpend(t) && basis.includes(monthOf(t.date)));

  const oneOffs = spend.filter(isOneOff);
  const oneOffIds = new Set(oneOffs.map((t) => t.id));
  const regular = spend.filter((t) => !oneOffIds.has(t.id));

  // repeating: the same bills the Recurring screen shows, including what the person confirmed, cancelled or added by hand. A bill set aside
  // as "not recurring" counts as everyday spending again; a cancelled or stopped one is no longer expected and its past charges leave the average.
  const rec = summarizeRecurring(personal, ctx.recurring, asOf);
  const on = rec.items.filter((i) => i.status === 'on' && i.health !== 'stopped');
  const recurring: RecurringItem[] = on.map((i) => ({ merchant: i.merchant, category: i.category as CategoryId | undefined, typical: i.monthlyCents, months: i.count }));
  const seriesIds = new Set(rec.items.filter((i) => i.status !== 'ignored').flatMap((i) => i.txnIds));
  // a bill added by hand (say, one seen once and answered "repeats monthly") has no series of its own: its charges leave the average too
  const manualPayees = new Set(on.filter((i) => i.source === 'manual').map((i) => normKey(i.merchant)));
  recurring.sort((a, b) => b.typical - a.typical);

  // everyday: everything else, averaged per complete month
  const variable = regular.filter((t) => !seriesIds.has(t.id) && !manualPayees.has(normKey(t.merchant)));
  const perMonth = basis.map((m) => variable.filter((t) => monthOf(t.date) === m).reduce((s, t) => s - t.cents, 0));
  const n = Math.max(basis.length, 1);
  const variableTotal = Math.round(perMonth.reduce((a, b) => a + b, 0) / n);
  const catTotals = new Map<CategoryId, number>();
  for (const t of variable) catTotals.set(t.category ?? 'uncategorized', (catTotals.get(t.category ?? 'uncategorized') ?? 0) - t.cents);
  const variableByCategory = [...catTotals.entries()].map(([category, v]) => ({ category, label: categoryLabel(category), estimate: Math.round(v / n) })).sort((a, b) => b.estimate - a.estimate);

  const recurringTotal = recurring.reduce((s, r) => s + r.typical, 0);
  let total = recurringTotal + variableTotal;
  let low = recurringTotal + (perMonth.length ? Math.min(...perMonth) : 0);
  let high = recurringTotal + (perMonth.length ? Math.max(...perMonth) : 0);
  // with under three months the spread between them says little: the range is at least 15% of everyday spending either way
  if (basis.length && basis.length < 3) { const pad = Math.round(variableTotal * 0.15); low = Math.min(low, total - pad); high = Math.max(high, total + pad); }

  // blend in the target month's own spending once statements cover a week of it (one-offs stay out, as in the average)
  let pace: Forecast['pace'];
  const dim = daysInMonth(target);
  const daysElapsed = coveredDays(ctx, target);
  const tm = personal.filter((t) => isSpend(t) && monthOf(t.date) === target && Number(t.date.slice(8)) <= daysElapsed && !isOneOff(t));
  if (basis.length && daysElapsed >= 7 && daysElapsed < dim) {
    const spentSoFar = tm.reduce((s, t) => s - t.cents, 0);
    const paceTotal = Math.round((spentSoFar / daysElapsed) * dim);
    const weight = daysElapsed / dim;
    const blended = Math.max(spentSoFar, Math.round(weight * paceTotal + (1 - weight) * total));
    pace = { spentSoFar, daysElapsed, paceTotal, weight };
    low = Math.max(spentSoFar, Math.min(low, blended)); high = Math.max(high, blended); total = blended;
  }

  const confidence: Forecast['confidence'] = basis.length < 4 ? 'low' : basis.length < 9 ? 'medium' : 'high';
  const caveat = basis.length === 0
    ? 'No complete month of statements yet, so there is nothing to base a forecast on.'
    : confidence === 'low'
      ? `Based on ${basis.length} complete month${basis.length === 1 ? '' : 's'}. Treat this as a rough range; it tightens as months are added.`
      : `Based on ${basis.length} complete months.`;

  return {
    month: target, total, low, high, recurringTotal, variableTotal, recurring, variableByCategory,
    oneOffsExcluded: oneOffs.map((t) => ({ merchant: t.merchant, date: t.date, cents: -t.cents, confirmed: t.oneOff === true })),
    basisMonths: basis, confidence, caveat, pace,
  };
}
