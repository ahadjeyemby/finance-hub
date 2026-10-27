import { daysInMonth, monthEnd, monthOf, monthStart, monthsBetween } from './dates';
import type { Ctx } from './queries';
import type { Account, StatementPeriod } from './types';

// Which days the statements really cover. An account's `coverage` is only its first and last statement day, so a statement missing in between
// would still look covered. When the saved statements are known (Ctx.statements) they decide; an account with none falls back to its
// first-to-last envelope, which is what the app knew before statements were loaded.

export interface Interval { from: string; to: string }

const dayMs = 86400000;
export const addDay = (iso: string, n = 1) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
export const daysBetweenIncl = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;

/** Accounts whose statements carry spending: checking and cards. Cash is entered by hand and has no statements. */
export const spendAccounts = (accounts: Account[]) => accounts.filter((a) => a.type === 'credit' || a.type === 'checking');

/** Merge overlapping or touching intervals. */
export function merge(xs: Interval[]): Interval[] {
  const sorted = xs.filter((x) => x.from && x.to && x.from <= x.to).sort((a, b) => a.from.localeCompare(b.from));
  const out: Interval[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.from <= addDay(last.to)) { if (x.to > last.to) last.to = x.to; } else out.push({ ...x });
  }
  return out;
}

/**
 * The days one account has statements for. A ledger loaded before statements were saved one by one may have rows only for some of them, so
 * the envelope is trusted before the first saved statement and after the last; only a hole between two saved statements is a missing one.
 */
export function intervalsFor(a: Account, statements: StatementPeriod[] | undefined): Interval[] {
  const own = merge((statements ?? []).filter((s) => s.accountId === a.id && s.from && s.to).map((s) => ({ from: s.from, to: s.to })));
  if (!own.length) return [{ from: a.coverage.from, to: a.coverage.to }];
  const edges: Interval[] = [];
  if (a.coverage.from < own[0].from) edges.push({ from: a.coverage.from, to: addDay(own[0].from, -1) });
  if (a.coverage.to > own[own.length - 1].to) edges.push({ from: addDay(own[own.length - 1].to), to: a.coverage.to });
  return merge([...own, ...edges]);
}

/** Is every day from `from` to `to` inside the intervals? */
export const covers = (xs: Interval[], from: string, to: string) => xs.some((x) => x.from <= from && x.to >= to);

/** The parts of [from, to] the intervals do not cover. */
export function gaps(xs: Interval[], from: string, to: string): Interval[] {
  const out: Interval[] = [];
  let cur = from;
  for (const x of merge(xs)) {
    if (x.to < cur) continue;
    if (x.from > to) break;
    if (x.from > cur) out.push({ from: cur, to: addDay(x.from, -1) < to ? addDay(x.from, -1) : to });
    cur = addDay(x.to);
    if (cur > to) return out;
  }
  if (cur <= to) out.push({ from: cur, to });
  return out;
}

/** A month is complete only if every spending account's statements cover all of it. No spending accounts means no complete month. */
export function completeMonths(ctx: Pick<Ctx, 'accounts' | 'statements'>, from: string, to: string): string[] {
  const spend = spendAccounts(ctx.accounts);
  if (!spend.length) return [];
  const iv = spend.map((a) => intervalsFor(a, ctx.statements));
  return monthsBetween(monthOf(from), monthOf(to)).filter((m) => iv.every((xs) => covers(xs, monthStart(m), monthEnd(m))));
}

/**
 * How many days of a month, from the 1st without a break, every spending account has statements for. Used for "so far" months and for the
 * month pace, which needs a week of recorded days.
 */
export function coveredDays(ctx: Pick<Ctx, 'accounts' | 'statements'>, month: string): number {
  const spend = spendAccounts(ctx.accounts);
  if (!spend.length) return 0;
  let days = daysInMonth(month);
  for (const a of spend) {
    const x = intervalsFor(a, ctx.statements).find((i) => i.from <= monthStart(month) && i.to >= monthStart(month));
    if (!x) return 0;
    days = Math.min(days, x.to >= monthEnd(month) ? daysInMonth(month) : Number(x.to.slice(8)));
  }
  return days;
}
