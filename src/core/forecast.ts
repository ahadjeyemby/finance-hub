import { categoryLabel } from './categories';
import { addMonths, daysInMonth, monthEnd, monthOf, monthStart, monthsBetween } from './dates';
import type { Ctx } from './queries';
import type { CategoryId, Txn } from './types';

export interface RecurringItem { merchant: string; category?: CategoryId; typical: number; months: number }
export interface Forecast {
  month: string;
  total: number; low: number; high: number;
  recurringTotal: number; variableTotal: number;
  recurring: RecurringItem[];
  variableByCategory: { category: CategoryId; label: string; estimate: number }[];
  oneOffsExcluded: { merchant: string; date: string; cents: number }[];
  basisMonths: string[];
  confidence: 'low' | 'medium' | 'high';
  /** plain-language caveat shown next to the number */
  caveat: string;
  /** when the target month already has data, how the estimate blends it in */
  pace?: { spentSoFar: number; daysElapsed: number; paceTotal: number; weight: number };
}

const isSpend = (t: Txn) => t.kind === 'spend' || t.kind === 'fee' || t.kind === 'refund';
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** A month is "complete" only if every spending account's statements cover all of it. */
export function completeMonths(ctx: Ctx, from: string, to: string): string[] {
  const spendAccounts = ctx.accounts.filter((a) => a.type === 'credit' || a.type === 'checking');
  return monthsBetween(monthOf(from), monthOf(to)).filter((m) =>
    spendAccounts.every((a) => a.coverage.from <= monthStart(m) && a.coverage.to >= monthEnd(m)));
}

export function forecastMonth(ctx: Ctx, target: string, asOf: string): Forecast {
  const lastData = ctx.txns.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
  const basis = completeMonths(ctx, '2000-01-01', addMonths(target, -1)).filter((m) => m < target);
  const spend = ctx.txns.filter((t) => isSpend(t) && !t.business && basis.includes(monthOf(t.date)));

  // one-offs: marked by the user or >= $1,000 in a single charge
  const oneOffs = spend.filter((t) => t.oneOff || (t.cents <= -100000 && t.oneOff !== false));
  const oneOffIds = new Set(oneOffs.map((t) => t.id));
  const regular = spend.filter((t) => !oneOffIds.has(t.id));

  // recurring: same merchant in >= 2 complete months with a stable amount (within 25% of the median)
  const byMerchant = new Map<string, Txn[]>();
  for (const t of regular) byMerchant.set(t.merchant, [...(byMerchant.get(t.merchant) ?? []), t]);
  const recurring: RecurringItem[] = [];
  const recurringMerchants = new Set<string>();
  for (const [merchant, ts] of byMerchant) {
    const months = new Map<string, number>();
    for (const t of ts) months.set(monthOf(t.date), (months.get(monthOf(t.date)) ?? 0) + -t.cents);
    if (months.size < 2) continue;
    const monthlyTotals = [...months.values()];
    const med = median(monthlyTotals);
    const stable = monthlyTotals.every((v) => Math.abs(v - med) <= med * 0.25);
    const needsEvery = Math.min(basis.length, 2);
    if (stable && months.size >= needsEvery && ts.every((t) => t.category !== 'groceries' && t.category !== 'fuel' && t.category !== 'mixed_retail')) {
      recurring.push({ merchant, category: ts[0].category, typical: med, months: months.size });
      recurringMerchants.add(merchant);
    }
  }
  recurring.sort((a, b) => b.typical - a.typical);

  // variable: everything else, averaged per complete month
  const variable = regular.filter((t) => !recurringMerchants.has(t.merchant));
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

  // blend in the target month's own data once it has a week of history
  let pace: Forecast['pace'];
  const tm = ctx.txns.filter((t) => isSpend(t) && !t.business && monthOf(t.date) === target);
  const dim = daysInMonth(target);
  const cap = lastData < monthEnd(target) ? lastData : monthEnd(target);
  const daysElapsed = monthOf(cap) === target ? Number(cap.slice(8)) : 0;
  if (tm.length && daysElapsed >= 7 && daysElapsed < dim) {
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
    oneOffsExcluded: oneOffs.map((t) => ({ merchant: t.merchant, date: t.date, cents: -t.cents })),
    basisMonths: basis, confidence, caveat, pace,
  };
}
