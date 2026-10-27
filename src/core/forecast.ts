import { categoryLabel } from './categories';
import { completeMonths, coveredDays } from './coverage';
import { addMonths, daysInMonth, monthOf } from './dates';
import type { Ctx } from './queries';
import { normKey, summarizeRecurring } from './recurring';
import type { RecurringItem as Bill, RecurringState } from './recurring';
import type { CategoryId, Txn } from './types';

export { completeMonths } from './coverage';

export interface RecurringItem { merchant: string; category?: CategoryId; typical: number; months: number }
export interface Forecast {
  month: string;
  total: number; low: number; high: number;
  recurringTotal: number; variableTotal: number;
  recurring: RecurringItem[];
  variableByCategory: { category: CategoryId; label: string; estimate: number }[];
  /** left out of the forecast: confirmed one-offs, and large charges nobody has answered for yet (confirmed false) */
  oneOffsExcluded: { merchant: string; date: string; cents: number; confirmed: boolean }[];
  basisMonths: string[];
  confidence: 'low' | 'medium' | 'high';
  /** plain-language caveat shown next to the number */
  caveat: string;
  /** when the target month already has a week of statements, how the estimate blends it in */
  pace?: { spentSoFar: number; daysElapsed: number; paceTotal: number; weight: number };
}

const isSpend = (t: Txn) => t.kind === 'spend' || t.kind === 'fee' || t.kind === 'refund';

/** A one-off on the charge itself: marked by the person, or a large charge (the large_one_off hint) nobody has answered for. */
export const isOneOff = (t: Txn) => t.oneOff === true || (t.oneOff === undefined && !!t.hints?.includes('large_one_off'));

export interface RecurringBasis {
  /** the bills still expected: switched on, and not stopped */
  on: Bill[];
  /** every charge that belongs to a bill the person did not set aside: it is repeating spending, never everyday or a one-off */
  seriesIds: Set<string>;
  /** payees of bills added by hand (they have no series of their own) */
  manualPayees: Set<string>;
  /** a one-off for averages and forecasts: one the person marked, or a large unanswered charge that is not part of a repeating bill */
  isOneOff: (t: Txn) => boolean;
  /** everyday spending: not a bill, not a one-off */
  isEveryday: (t: Txn) => boolean;
}

/**
 * The bills and the one-offs every average and forecast is built from, so the Recurring screen, the forecast and the dashboard agree.
 * Charges marked one-time never make a bill. A bill the person cancelled, or one that stopped, still owns its past charges (they are not
 * everyday spending); one they set aside as "not recurring" gives its charges back to everyday spending.
 */
export function recurringBasis(txns: Txn[], recurring: RecurringState | undefined, asOf: string): RecurringBasis {
  const items = summarizeRecurring(txns.filter((t) => t.oneOff !== true), recurring, asOf).items;
  const kept = items.filter((i) => i.status !== 'ignored');
  const seriesIds = new Set(kept.flatMap((i) => i.txnIds));
  const manualPayees = new Set(kept.filter((i) => i.source === 'manual').map((i) => normKey(i.merchant)));
  const oneOff = (t: Txn) => t.oneOff === true || (t.oneOff === undefined && !!t.hints?.includes('large_one_off') && !seriesIds.has(t.id));
  return {
    on: items.filter((i) => i.status === 'on' && i.health !== 'stopped'), seriesIds, manualPayees, isOneOff: oneOff,
    isEveryday: (t) => !oneOff(t) && !seriesIds.has(t.id) && !manualPayees.has(normKey(t.merchant)),
  };
}

/**
 * Next month (or any month), from complete months only. `scope` 'personal' (the default) leaves business spending out; 'given' uses the
 * charges in ctx as they are, for a dashboard view that has already chosen whose spending it counts.
 */
export function forecastMonth(ctx: Ctx, target: string, asOf: string, scope: 'personal' | 'given' = 'personal'): Forecast {
  const basis = completeMonths(ctx, '2000-01-01', addMonths(target, -1)).filter((m) => m < target);
  const pool = scope === 'personal' ? ctx.txns.filter((t) => !t.business) : ctx.txns;
  const spend = pool.filter((t) => isSpend(t) && basis.includes(monthOf(t.date)));
  const b = recurringBasis(pool, ctx.recurring, asOf);

  const oneOffs = spend.filter(b.isOneOff);
  const recurring: RecurringItem[] = b.on.map((i) => ({ merchant: i.merchant, category: i.category as CategoryId | undefined, typical: i.monthlyCents, months: i.count }));
  recurring.sort((x, y) => y.typical - x.typical);

  // everyday: everything that is neither a bill nor a one-off, averaged per complete month
  const variable = spend.filter(b.isEveryday);
  const perMonth = basis.map((m) => variable.filter((t) => monthOf(t.date) === m).reduce((s, t) => s - t.cents, 0));
  const n = Math.max(basis.length, 1);
  const variableTotal = Math.round(perMonth.reduce((x, y) => x + y, 0) / n);
  const catTotals = new Map<CategoryId, number>();
  for (const t of variable) catTotals.set(t.category ?? 'uncategorized', (catTotals.get(t.category ?? 'uncategorized') ?? 0) - t.cents);
  const variableByCategory = [...catTotals.entries()].map(([category, v]) => ({ category, label: categoryLabel(category), estimate: Math.round(v / n) })).sort((x, y) => y.estimate - x.estimate);

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
  const tm = pool.filter((t) => isSpend(t) && monthOf(t.date) === target && Number(t.date.slice(8)) <= daysElapsed && !b.isOneOff(t));
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
