// Recurring charges: subscriptions, rent, bills, anything that comes round on a rhythm. Pure TypeScript: no React, no network, no model.
//
// The aim is one number the person can plan around: what they must have each month to run their life. The engine finds the charges that repeat
// (same payee, regular spacing, similar amount), says how often and when the next one is due, notices a price change or a missed one, and turns
// every rhythm into a monthly equivalent (a yearly $120 is $10 a month). The person confirms, ignores or cancels what it found and can add what it
// cannot see (rent paid in cash before there is a history). Nothing here guesses silently: each item says how many charges it rests on.
import { categoryLabel } from './categories';
import { monthOf } from './dates';
import { completeMonths } from './coverage';
import type { Ctx } from './queries';
import type { Txn } from './types';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export const CADENCE_LABEL: Record<Cadence, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Every 3 months', semiannual: 'Every 6 months', annual: 'Yearly' };
/** how many of this cadence fit in a month, for the monthly equivalent */
const PER_MONTH: Record<Cadence, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12 };
/** how many the person said there are: a whole number from 1 to 99 */
const quantityOf = (e?: RecurringEdit) => (e?.quantity && Number.isFinite(e.quantity) ? Math.min(99, Math.max(1, Math.round(e.quantity))) : 1);
const noteOf = (...xs: (string | undefined)[]) => xs.map((x) => x?.trim()).find(Boolean) || undefined;
const NOMINAL: Record<Cadence, { days: number; tol: number }> = {
  weekly: { days: 7, tol: 2 }, biweekly: { days: 14, tol: 3 }, monthly: { days: 30.4, tol: 5 }, quarterly: { days: 91, tol: 10 }, semiannual: { days: 182, tol: 14 }, annual: { days: 365, tol: 20 },
};

export interface ManualRecurring { id: string; merchant: string; cents: number; cadence: Cadence; /** a date it was or will be due; later dates follow the cadence */ anchor: string; category?: string; note?: string }
export interface RecurringEdit {
  status: 'confirmed' | 'ignored' | 'cancelled';
  /** the person's own amount or rhythm for it */
  cents?: number;
  cadence?: Cadence;
  /** a line of their own about it, such as which account it is on */
  note?: string;
  /** how many of them there are: two accounts each renewing at $99 a year is 2. The amount stays what one charge is. */
  quantity?: number;
}
export interface RecurringState { edits: Record<string, RecurringEdit>; manual: ManualRecurring[] }
export const emptyRecurring = (): RecurringState => ({ edits: {}, manual: [] });

export interface RecurringItem {
  key: string;
  merchant: string;
  category?: string;
  cadence: Cadence;
  /** what one charge usually is, in cents (positive) */
  cents: number;
  /** how many of them the person said there are (1 unless set); the monthly figure counts all of them */
  quantity: number;
  /** the person's own line about it */
  note?: string;
  /** what this costs per month on average, for all of them */
  monthlyCents: number;
  lastDate?: string;
  lastCents?: number;
  /** the next date it is expected on, on or after the day asked about */
  nextDue: string;
  /** the expected date is after the last statement, so it is a projection */
  projected: boolean;
  count: number;
  /** the amounts differ by more than a bill's usual wobble (a variable bill such as electricity) */
  varies: boolean;
  /** the last charge differs from the ones before it: a price change */
  change?: { from: number; to: number };
  /** active = on rhythm, late = one expected charge has not appeared, stopped = more than one has not */
  health: 'active' | 'late' | 'stopped';
  /** confirmed by the person, found by the engine, or added by hand */
  source: 'confirmed' | 'detected' | 'manual';
  status: 'on' | 'ignored' | 'cancelled';
  /** spending on it over the last 12 months */
  yearCents: number;
  txnIds: string[];
}

export interface RecurringSummary {
  items: RecurringItem[];
  /** monthly equivalent of everything switched on: the fixed amount to plan for */
  fixedMonthlyCents: number;
  /** the part of that resting on a pattern the person has not confirmed */
  unconfirmedMonthlyCents: number;
  /** what is expected to leave in the next 30 days */
  next30Cents: number;
  upcoming: { key: string; merchant: string; date: string; cents: number }[];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const dayMs = 86400000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * dayMs).toISOString().slice(0, 10);
/** Add calendar months, keeping the day (or the last day of a shorter month): Jan 31 + 1 month is Feb 28. */
export function addMonthsTo(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const step = (iso: string, c: Cadence, times = 1): string =>
  c === 'weekly' ? addDays(iso, 7 * times) : c === 'biweekly' ? addDays(iso, 14 * times) : addMonthsTo(iso, ({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as const)[c] * times);

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
/** The payee a charge belongs to, for telling one series from another: lower case, no store numbers or punctuation. */
export const normKey = (merchant: string) => merchant.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();

/** Which rhythm the dates follow, if one fits at least three quarters of the gaps between them. */
export function detectCadence(dates: string[]): Cadence | null {
  const d = [...new Set(dates)].sort();
  if (d.length < 2) return null;
  const gaps = d.slice(1).map((x, i) => days(d[i], x));
  let best: { c: Cadence; fit: number } | null = null;
  for (const c of Object.keys(NOMINAL) as Cadence[]) {
    const { days: n, tol } = NOMINAL[c];
    const fit = gaps.filter((g) => Math.abs(g - n) <= tol).length / gaps.length;
    if (fit >= 0.75 && (!best || fit > best.fit)) best = { c, fit };
  }
  return best?.c ?? null;
}

// ---------------------------------------------------------------------------
// Finding the series
// ---------------------------------------------------------------------------
/** Everyday buying is not a subscription: groceries, fuel, restaurants and big-box stores repeat but are not fixed. The person can still confirm one. */
const EVERYDAY = new Set(['groceries', 'fuel', 'restaurants', 'mixed_retail', 'online_shopping', 'clothing', 'travel']);

const spread = (xs: number[]) => { const m = median(xs); return m > 0 ? (Math.max(...xs) - Math.min(...xs)) / m : 1; };

/** Split a payee's charges into runs of similar amounts: Apple at $0.99 and Apple at $9.99 are two subscriptions. */
function byAmount(ts: Txn[]): Txn[][] {
  const sorted = [...ts].sort((a, b) => a.cents - b.cents);
  const groups: Txn[][] = [];
  for (const t of sorted) {
    const g = groups.find((x) => Math.abs(Math.abs(x[0].cents) - Math.abs(t.cents)) <= Math.abs(x[0].cents) * 0.12);
    if (g) g.push(t); else groups.push([t]);
  }
  return groups;
}

interface Series { key: string; merchant: string; txns: Txn[]; cadence: Cadence }

function findSeries(txns: Txn[]): Series[] {
  const byPayee = new Map<string, Txn[]>();
  for (const t of txns) { const k = normKey(t.merchant); if (k) byPayee.set(k, [...(byPayee.get(k) ?? []), t]); }
  const out: Series[] = [];
  for (const [key, all] of byPayee) {
    const merchant = [...all].sort((a, b) => b.date.localeCompare(a.date))[0].merchant;
    const ok = (ts: Txn[]) => {
      if (ts.length < 2) return null;
      const cadence = detectCadence(ts.map((t) => t.date));
      if (!cadence) return null;
      const amounts = ts.map((t) => -t.cents);
      // two charges are a pattern only if they match; with three or more a bill may wobble
      if (ts.length === 2 ? spread(amounts) > 0.05 : spread(amounts) > 0.6) return null;
      return cadence;
    };
    const whole = ok(all);
    if (whole) { out.push({ key, merchant, txns: all, cadence: whole }); continue; }
    for (const g of byAmount(all)) {
      const c = ok(g);
      if (c) out.push({ key: `${key}|${Math.round(median(g.map((t) => -t.cents)) / 100)}`, merchant, txns: g, cadence: c });
    }
  }
  return out;
}

/** The first expected date after `asOf`, stepping forward from the last charge. Also how many expected dates have already passed without a charge. */
function project(last: string, cadence: Cadence, asOf: string): { next: string; missed: number } {
  let next = step(last, cadence);
  let missed = 0;
  const grace = cadence === 'weekly' ? 3 : cadence === 'biweekly' ? 4 : cadence === 'monthly' ? 6 : 10;
  let guard = 0;
  while (next <= asOf && guard++ < 400) {
    if (days(next, asOf) > grace) missed++;
    next = step(next, cadence);
  }
  return { next, missed };
}

/**
 * What repeats, from the charges, the person's decisions and the items they added by hand. `asOf` is the last day the statements cover: a charge
 * is only called missing when its due date falls inside the data, never after it.
 */
export function summarizeRecurring(txns: Txn[], state: RecurringState | undefined, asOf: string, today: string = asOf): RecurringSummary {
  const edits = state?.edits ?? {};
  const spend = txns.filter((t) => (t.kind === 'spend' || t.kind === 'fee') && t.cents < 0);
  const items: RecurringItem[] = [];

  for (const s of findSeries(spend)) {
    const e = edits[s.key];
    const cat = s.txns[0].category as string | undefined;
    // everyday buying is left out unless the person said it is recurring
    if (cat && EVERYDAY.has(cat) && e?.status !== 'confirmed') continue;
    const ts = [...s.txns].sort((a, b) => a.date.localeCompare(b.date));
    const last = ts[ts.length - 1];
    const amounts = ts.map((t) => -t.cents);
    const earlier = amounts.slice(0, -1);
    const varies = ts.length >= 3 && spread(earlier.length >= 2 ? earlier : amounts) > 0.12;
    const prev = median(earlier);
    const change = !varies && earlier.length >= 1 && Math.abs(amounts[amounts.length - 1] - prev) >= 50 && Math.abs(amounts[amounts.length - 1] - prev) / prev >= 0.03 ? { from: prev, to: amounts[amounts.length - 1] } : undefined;
    const cadence = e?.cadence ?? s.cadence;
    const cents = e?.cents ?? (varies ? median(amounts) : amounts[amounts.length - 1]);
    const quantity = quantityOf(e);
    const { next, missed } = project(last.date, cadence, asOf);
    const yearAgo = addDays(asOf, -365);
    items.push({
      key: s.key, merchant: s.merchant, category: cat, cadence, cents, quantity, ...(noteOf(e?.note) ? { note: noteOf(e?.note) } : {}), monthlyCents: Math.round(cents * quantity * PER_MONTH[cadence]),
      lastDate: last.date, lastCents: -last.cents, nextDue: next, projected: next > asOf, count: ts.length, varies, ...(change ? { change } : {}),
      health: missed === 0 ? 'active' : missed === 1 ? 'late' : 'stopped',
      source: e?.status === 'confirmed' ? 'confirmed' : 'detected', status: e?.status === 'ignored' ? 'ignored' : e?.status === 'cancelled' ? 'cancelled' : 'on',
      yearCents: ts.filter((t) => t.date > yearAgo).reduce((sum, t) => sum - t.cents, 0), txnIds: ts.map((t) => t.id),
    });
  }

  // added by hand: rent paid in cash before there is a history, a yearly bill not yet seen. Dropped when the engine now finds the same payee.
  const found = new Set(items.map((i) => i.key.split('|')[0]));
  for (const m of state?.manual ?? []) {
    if (found.has(normKey(m.merchant))) continue;
    const key = `m:${m.id}`; const e = edits[key];
    const cadence = e?.cadence ?? m.cadence; const cents = e?.cents ?? m.cents; const quantity = quantityOf(e); const note = noteOf(e?.note, m.note);
    let next = m.anchor; let guard = 0;
    while (next <= today && guard++ < 400) next = step(next, cadence);
    items.push({
      key, merchant: m.merchant, category: m.category, cadence, cents, quantity, ...(note ? { note } : {}), monthlyCents: Math.round(cents * quantity * PER_MONTH[cadence]), nextDue: next, projected: next > asOf, count: 0, varies: false,
      health: 'active', source: 'manual', status: e?.status === 'cancelled' ? 'cancelled' : e?.status === 'ignored' ? 'ignored' : 'on', yearCents: 0, txnIds: [],
    });
  }

  const on = items.filter((i) => i.status === 'on' && i.health !== 'stopped');
  const horizon = addDays(today, 30);
  const upcoming: RecurringSummary['upcoming'] = [];
  for (const i of on) {
    let d = i.nextDue; let guard = 0;
    while (d <= horizon && guard++ < 10) { if (d >= today) upcoming.push({ key: i.key, merchant: i.merchant, date: d, cents: i.cents * i.quantity }); d = step(d, i.cadence); }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || b.cents - a.cents);

  items.sort((a, b) => Number(a.status !== 'on') - Number(b.status !== 'on') || b.monthlyCents - a.monthlyCents);
  return {
    items,
    fixedMonthlyCents: on.reduce((s, i) => s + i.monthlyCents, 0),
    unconfirmedMonthlyCents: on.filter((i) => i.source === 'detected').reduce((s, i) => s + i.monthlyCents, 0),
    next30Cents: upcoming.reduce((s, u) => s + u.cents, 0),
    upcoming,
  };
}

export interface IncomeVsFixed {
  /** the complete months the average rests on (at most the last three) */
  months: string[];
  /** average monthly income over those months, not counting income still marked unconfirmed */
  incomeCents: number;
  /** average monthly income the person has not yet confirmed, left out of the figure above */
  unconfirmedCents: number;
  /** what is left of the average income after the fixed amount; negative when fixed costs exceed it */
  leftCents: number;
  /** fixed amount as a share of income, null when there is no income to compare with */
  share: number | null;
  /** a checking account's statements may not show all income, so the figure can be low */
  incomeIncomplete: boolean;
}

/**
 * How the fixed monthly amount compares with what comes in. Income is averaged over the last three complete months so a part-covered month never
 * pulls it down; with no complete month there is nothing to compare and the result is null.
 */
export function incomeVsFixed(ctx: Ctx, fixedMonthlyCents: number, asOf: string): IncomeVsFixed | null {
  const months = completeMonths(ctx, '2000-01-01', monthOf(asOf)).slice(-3);
  if (!months.length) return null;
  const inMonths = ctx.txns.filter((t) => t.kind === 'income' && !t.business && months.includes(monthOf(t.date)));
  const sum = (ts: Txn[]) => Math.round(ts.reduce((s, t) => s + t.cents, 0) / months.length);
  const incomeCents = sum(inMonths.filter((t) => t.subtype !== 'unconfirmed'));
  return {
    months, incomeCents, unconfirmedCents: sum(inMonths.filter((t) => t.subtype === 'unconfirmed')),
    leftCents: incomeCents - fixedMonthlyCents, share: incomeCents > 0 ? fixedMonthlyCents / incomeCents : null,
    incomeIncomplete: ctx.accounts.some((a) => a.type === 'checking' && a.incomeComplete === false),
  };
}

export const categoryOf = (i: RecurringItem) => (i.category ? categoryLabel(i.category) : '');

// ---------------------------------------------------------------------------
// Changes the person makes
// ---------------------------------------------------------------------------
const base = (s?: RecurringState): RecurringState => ({ edits: { ...(s?.edits ?? {}) }, manual: [...(s?.manual ?? [])] });

/** Confirm, ignore or cancel an item, or clear the decision (back to what the engine found). */
export function decide(s: RecurringState | undefined, key: string, status: RecurringEdit['status'] | null, over: { cents?: number; cadence?: Cadence; note?: string; quantity?: number } = {}): RecurringState {
  const next = base(s);
  const cur: Partial<RecurringEdit> = { ...(next.edits[key] ?? {}), ...over };
  // an empty note, or a quantity of 1, is the same as none: leave it out so the saved decision stays small
  if (!cur.note?.trim()) delete cur.note; else cur.note = cur.note.trim().slice(0, 200);
  if (!cur.quantity || cur.quantity <= 1) delete cur.quantity; else cur.quantity = Math.min(99, Math.round(cur.quantity));
  if (cur.cents == null) delete cur.cents;
  if (!cur.cadence) delete cur.cadence;
  if (status) next.edits[key] = { ...cur, status } as RecurringEdit;
  else if (cur.cents != null || cur.cadence || cur.note || cur.quantity) next.edits[key] = { ...cur, status: next.edits[key]?.status ?? 'confirmed' } as RecurringEdit;
  else delete next.edits[key];
  return next;
}

export function addManual(s: RecurringState | undefined, m: Omit<ManualRecurring, 'id'>): RecurringState {
  const next = base(s);
  const id = `${Date.now().toString(36)}${next.manual.length}`;
  next.manual.push({ id, ...m, merchant: m.merchant.trim() });
  return next;
}

export function removeManual(s: RecurringState | undefined, id: string): RecurringState {
  const next = base(s);
  next.manual = next.manual.filter((m) => m.id !== id);
  delete next.edits[`m:${id}`];
  return next;
}
