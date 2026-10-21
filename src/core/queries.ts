import { categoryGroup, categoryLabel } from './categories';
import { dayLabel, monthLabel, monthOf, weekStart } from './dates';
import type { Account, CategoryId, Kind, Overlay, Txn } from './types';

// ---------------------------------------------------------------------------
// One deterministic query engine. The dashboard, the reports and the AI agent
// all call runQuery, so a number can never differ between screens.
// ---------------------------------------------------------------------------

export interface Filter {
  from?: string;
  to?: string;
  kinds?: Kind[];
  categories?: CategoryId[];
  /** keep charges carrying any of these tags (see tags.ts) */
  tags?: string[];
  merchants?: string[];
  accounts?: string[];
  scope?: 'all' | 'personal' | 'business';
  text?: string;
  minCents?: number;
}

export type Metric = 'spend' | 'income' | 'rewards' | 'net' | 'transfers' | 'count' | 'average';
export type GroupBy = 'category' | 'subcategory' | 'merchant' | 'month' | 'week' | 'day' | 'account' | 'weekday' | 'need_want';

export interface QuerySpec {
  metric: Metric;
  groupBy?: GroupBy;
  filter?: Filter;
  sort?: 'value_desc' | 'value_asc' | 'key';
  limit?: number;
  /** fold everything past `limit` into one "Other" row */
  foldOther?: boolean;
}

export interface Row { key: string; label: string; long: string; value: number; count: number }
export interface QueryResult { spec: QuerySpec; rows: Row[]; total: number; count: number }
export interface Ctx { txns: Txn[]; accounts: Account[] }

const SPEND_KINDS: Kind[] = ['spend', 'fee', 'refund'];

/** Signed contribution of one transaction to a metric, in cents. null = does not count. */
function contribution(t: Txn, metric: Metric, ctx: Ctx): number | null {
  switch (metric) {
    case 'spend': case 'count': case 'average':
      return SPEND_KINDS.includes(t.kind) ? -t.cents : null;
    case 'income': return t.kind === 'income' ? t.cents : null;
    case 'rewards': return t.kind === 'rewards' ? t.cents : null;
    case 'net': return t.kind === 'income' || SPEND_KINDS.includes(t.kind) ? t.cents : null;
    case 'transfers': {
      if (t.kind !== 'transfer') return null;
      const type = ctx.accounts.find((a) => a.id === t.accountId)?.type;
      // count each movement once: bank-side outflow, or a card-side leg with no bank match
      if (type === 'checking' || type === 'cash') return t.cents < 0 ? -t.cents : null;
      return t.pairId ? null : Math.abs(t.cents);
    }
  }
}

export function matches(t: Txn, f: Filter | undefined): boolean {
  if (!f) return true;
  if (f.from && t.date < f.from) return false;
  if (f.to && t.date > f.to) return false;
  if (f.kinds && !f.kinds.includes(t.kind)) return false;
  if (f.categories && !(t.category && f.categories.includes(t.category))) return false;
  if (f.tags && !(t.tags && f.tags.some((x) => t.tags!.includes(x)))) return false;
  if (f.merchants && !f.merchants.includes(t.merchant)) return false;
  if (f.accounts && !f.accounts.includes(t.accountId)) return false;
  if (f.scope === 'business' && !t.business) return false;
  if (f.scope === 'personal' && t.business) return false;
  if (f.text) { const q = f.text.toLowerCase(); if (!(t.merchant + ' ' + t.description + ' ' + (t.note ?? '')).toLowerCase().includes(q)) return false; }
  if (f.minCents != null && Math.abs(t.cents) < f.minCents) return false;
  return true;
}

function groupKey(t: Txn, g: GroupBy, ctx: Ctx): { key: string; label: string; long: string } {
  switch (g) {
    case 'category': { const k = t.category ?? 'uncategorized'; const l = categoryLabel(k); return { key: k, label: l, long: l }; }
    case 'subcategory': { const k = t.subcategory ?? '(none)'; return { key: k, label: k, long: k }; }
    case 'merchant': return { key: t.merchant, label: t.merchant, long: t.merchant };
    case 'month': { const k = monthOf(t.date); return { key: k, label: monthLabel(k, true), long: monthLabel(k) }; }
    case 'week': { const k = weekStart(t.date); return { key: k, label: dayLabel(k), long: `Week of ${dayLabel(k)}` }; }
    case 'day': return { key: t.date, label: dayLabel(t.date), long: dayLabel(t.date) };
    case 'account': { const a = ctx.accounts.find((x) => x.id === t.accountId); const l = a ? (a.last4 ? `${a.institution} ${a.last4}` : a.name) : t.accountId; return { key: t.accountId, label: l, long: a?.name ?? l }; }
    case 'weekday': { const d = new Date(t.date + 'T00:00:00Z').getUTCDay(); const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return { key: String((d + 6) % 7), label: names[d], long: names[d] }; }
    case 'need_want': { const k = categoryGroup(t.category); const l = k === 'need' ? 'Needs' : k === 'want' ? 'Wants' : 'Mixed or unsplit'; return { key: k, label: l, long: l }; }
  }
}

const TIME_GROUPS: GroupBy[] = ['month', 'week', 'day', 'weekday'];

export function runQuery(spec: QuerySpec, ctx: Ctx): QueryResult {
  const filter = spec.filter;
  const groups = new Map<string, Row & { _sum: number }>();
  let total = 0, count = 0;
  for (const t of ctx.txns) {
    if (!matches(t, filter)) continue;
    const c = contribution(t, spec.metric, ctx);
    if (c == null) continue;
    total += c; count += 1;
    if (!spec.groupBy) continue;
    const g = groupKey(t, spec.groupBy, ctx);
    const row = groups.get(g.key) ?? { key: g.key, label: g.label, long: g.long, value: 0, count: 0, _sum: 0 };
    row._sum += c; row.count += 1;
    groups.set(g.key, row);
  }
  const finalize = (sum: number, n: number) => (spec.metric === 'count' ? n : spec.metric === 'average' ? (n ? Math.round(sum / n) : 0) : sum);
  let rows: Row[] = [...groups.values()].map((r) => ({ key: r.key, label: r.label, long: r.long, count: r.count, value: finalize(r._sum, r.count) }));
  const isTime = spec.groupBy ? TIME_GROUPS.includes(spec.groupBy) : false;
  const sort = spec.sort ?? (isTime ? 'key' : 'value_desc');
  rows.sort(sort === 'key' ? (a, b) => a.key.localeCompare(b.key) : sort === 'value_asc' ? (a, b) => a.value - b.value : (a, b) => b.value - a.value);
  if (spec.limit && rows.length > spec.limit) {
    const head = rows.slice(0, spec.limit), tail = rows.slice(spec.limit);
    rows = spec.foldOther
      ? [...head, { key: '__other', label: 'Other', long: `Other (${tail.length} more)`, count: tail.reduce((s, r) => s + r.count, 0), value: tail.reduce((s, r) => s + r.value, 0) }]
      : head;
  }
  return { spec, rows, total: finalize(total, count), count };
}

/** Filter that selects exactly the transactions behind one bar/slice, for drill-down. */
export function drillFilter(spec: QuerySpec, rowKey: string): Filter {
  const f: Filter = { ...(spec.filter ?? {}) };
  if (rowKey === '__other') return f;
  switch (spec.groupBy) {
    case 'category': f.categories = [rowKey as CategoryId]; break;
    case 'merchant': f.merchants = [rowKey]; break;
    case 'account': f.accounts = [rowKey]; break;
    case 'month': f.from = maxIso(f.from, `${rowKey}-01`); f.to = minIso(f.to, `${rowKey}-31`); break;
    case 'week': { f.from = maxIso(f.from, rowKey); const d = new Date(rowKey + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); f.to = minIso(f.to, d.toISOString().slice(0, 10)); break; }
    case 'day': f.from = rowKey; f.to = rowKey; break;
    default: break;
  }
  if (!f.kinds) f.kinds = kindsFor(spec.metric);
  return f;
}
const maxIso = (a: string | undefined, b: string) => (a && a > b ? a : b);
const minIso = (a: string | undefined, b: string) => (a && a < b ? a : b);
export function kindsFor(metric: Metric): Kind[] | undefined {
  switch (metric) {
    case 'spend': case 'count': case 'average': return SPEND_KINDS;
    case 'income': return ['income'];
    case 'rewards': return ['rewards'];
    case 'net': return ['income', ...SPEND_KINDS];
    case 'transfers': return ['transfer'];
  }
}

export function listTxns(ctx: Ctx, filter: Filter, limit = 200, order: 'date_desc' | 'amount_desc' = 'date_desc'): Txn[] {
  const rows = ctx.txns.filter((t) => matches(t, filter));
  rows.sort(order === 'date_desc' ? (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id) : (a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Overlay: manual entries and user edits layered over the base ledger
// ---------------------------------------------------------------------------
export function applyOverlay(base: Txn[], overlay: Overlay): Txn[] {
  const out: Txn[] = [];
  for (const t of [...base, ...overlay.manual]) {
    const rule = overlay.merchantRules[t.merchant];
    const patch = overlay.patches[t.id];
    out.push(rule || patch ? { ...t, ...(t.kind === 'spend' || t.kind === 'refund' ? rule : {}), ...patch } : t);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Period summary + data coverage (the honesty layer)
// ---------------------------------------------------------------------------
export interface PeriodSummary {
  from: string; to: string;
  earned: number; rewards: number; spent: number; net: number; transfers: number;
  unconfirmedIncome: number;
  /** accounts whose statements stop before the end of the period */
  partialAccounts: { name: string; coveredTo: string }[];
  incomeIncomplete: boolean;
}

export function summarize(ctx: Ctx, from: string, to: string, scope: Filter['scope'] = 'all'): PeriodSummary {
  const f: Filter = { from, to, scope };
  const q = (metric: Metric, extra?: Filter) => runQuery({ metric, filter: { ...f, ...extra } }, ctx).total;
  const earned = q('income');
  const spent = q('spend');
  const partialAccounts = ctx.accounts
    .filter((a) => a.type !== 'cash' && a.coverage.to < to)
    .map((a) => ({ name: a.last4 ? `${a.institution} ${a.last4}` : a.name, coveredTo: a.coverage.to }));
  return {
    from, to, earned, rewards: q('rewards'), spent, net: earned - spent, transfers: q('transfers'),
    unconfirmedIncome: ctx.txns.filter((t) => t.kind === 'income' && t.subtype === 'unconfirmed' && matches(t, f)).reduce((s, t) => s + t.cents, 0),
    partialAccounts,
    incomeIncomplete: ctx.accounts.some((a) => a.type === 'checking' && a.incomeComplete === false),
  };
}

export const dollars = (cents: number, opts: { sign?: boolean; decimals?: boolean } = {}) => {
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: opts.decimals === false ? 0 : 2, maximumFractionDigits: opts.decimals === false ? 0 : 2 });
  return `${neg ? '-' : opts.sign && cents > 0 ? '+' : ''}$${s}`;
};
