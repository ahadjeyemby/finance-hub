import { categoryLabel } from './categories';
import { monthEnd, monthLabel, monthStart } from './dates';
import { listTxns, runQuery, summarize } from './queries';
import type { Ctx, Filter } from './queries';

// ---------------------------------------------------------------------------
// The deep-dive graph is a tree: Year > Month > Spending > Category > Store > Item.
// Every number comes from runQuery/listTxns, so it always agrees with the dashboard.
// ---------------------------------------------------------------------------
export type Level = 'year' | 'month' | 'kind' | 'category' | 'store' | 'item';
export const LEVELS: Level[] = ['year', 'month', 'kind', 'category', 'store', 'item'];
export const LEVEL_NAMES: Record<Level, string> = { year: 'Year', month: 'Month', kind: 'Money', category: 'Category', store: 'Store', item: 'Item' };

export interface Seg { level: Level; key: string }
export interface GNode {
  id: string; level: Level; key: string; label: string;
  cents: number; count: number;
  /** share of the parent node, 0 to 1 */
  share: number;
  /** no item detail behind these dollars */
  hatch?: boolean;
  /** statements for part of this period are missing */
  partial?: boolean;
  /** item booked to a different category than its store */
  countsAs?: string;
  leaf?: boolean;
  path: Seg[];
}

const KIND_LABEL: Record<string, string> = { spend: 'Spending', income: 'Earned', rewards: 'Rewards' };
const scopeOf = (scope: Filter['scope']): Filter => ({ scope });
const idOf = (path: Seg[]) => path.map((s) => `${s.level}:${s.key}`).join('|');

function node(path: Seg[], label: string, cents: number, count: number, parent: number, extra: Partial<GNode> = {}): GNode {
  const last = path[path.length - 1];
  return { id: idOf(path), level: last.level, key: last.key, label, cents, count, share: parent > 0 ? Math.min(1, Math.abs(cents) / parent) : 0, path, ...extra };
}

/** The filter that selects exactly the transactions behind a node. */
export function graphFilter(path: Seg[], scope: Filter['scope'] = 'all'): Filter {
  const f: Filter = { ...scopeOf(scope) };
  for (const s of path) {
    if (s.level === 'year') { f.from = `${s.key}-01-01`; f.to = `${s.key}-12-31`; }
    else if (s.level === 'month') { f.from = monthStart(s.key); f.to = monthEnd(s.key); }
    else if (s.level === 'kind') f.kinds = s.key === 'spend' ? ['spend', 'fee', 'refund'] : [s.key as 'income' | 'rewards'];
    else if (s.level === 'category') f.categories = [s.key as never];
    else if (s.level === 'store') f.merchants = [s.key];
  }
  return f;
}

const metricOf = (path: Seg[]) => (path.find((s) => s.level === 'kind')?.key ?? 'spend') as 'spend' | 'income' | 'rewards';

export function graphRoots(ctx: Ctx, scope: Filter['scope'] = 'all'): GNode[] {
  const months = runQuery({ metric: 'spend', groupBy: 'month', sort: 'key', filter: scopeOf(scope) }, ctx);
  const years = new Map<string, { cents: number; count: number }>();
  for (const r of months.rows) { const y = r.key.slice(0, 4); const c = years.get(y) ?? { cents: 0, count: 0 }; years.set(y, { cents: c.cents + r.value, count: c.count + r.count }); }
  const total = [...years.values()].reduce((s, v) => s + v.cents, 0);
  return [...years.entries()].sort().map(([y, v]) => node([{ level: 'year', key: y }], y, v.cents, v.count, total));
}

export function graphChildren(ctx: Ctx, path: Seg[], scope: Filter['scope'] = 'all'): GNode[] {
  const last = path[path.length - 1];
  const parentCents = (() => { const f = graphFilter(path, scope); const m = metricOf(path); return runQuery({ metric: m, filter: f }, ctx).total; })();
  const f = graphFilter(path, scope);

  if (last.level === 'year') {
    const q = runQuery({ metric: 'spend', groupBy: 'month', sort: 'key', filter: f }, ctx);
    return q.rows.map((r) => node([...path, { level: 'month', key: r.key }], monthLabel(r.key), r.value, r.count, q.total, { partial: summarize(ctx, monthStart(r.key), monthEnd(r.key), scope).partialAccounts.length > 0 }));
  }
  if (last.level === 'month') {
    const out: GNode[] = [];
    for (const k of ['spend', 'income', 'rewards'] as const) {
      const q = runQuery({ metric: k, filter: { ...f, kinds: k === 'spend' ? ['spend', 'fee', 'refund'] : [k] } }, ctx);
      if (q.total !== 0 || q.count) out.push(node([...path, { level: 'kind', key: k }], KIND_LABEL[k], q.total, q.count, 0, { share: 0 }));
    }
    const big = Math.max(1, ...out.map((n) => Math.abs(n.cents)));
    return out.map((n) => ({ ...n, share: Math.abs(n.cents) / big }));
  }
  if (last.level === 'kind') {
    if (last.key === 'spend') {
      const q = runQuery({ metric: 'spend', groupBy: 'category', sort: 'value_desc', filter: f }, ctx);
      return q.rows.filter((r) => r.value !== 0).map((r) => node([...path, { level: 'category', key: r.key }], categoryLabel(r.key), r.value, r.count, parentCents, { hatch: r.key === 'mixed_retail' || r.key === 'online_shopping' }));
    }
    const q = runQuery({ metric: last.key as 'income' | 'rewards', groupBy: 'merchant', sort: 'value_desc', filter: f }, ctx);
    return q.rows.map((r) => node([...path, { level: 'store', key: r.key }], r.label, r.value, r.count, parentCents, { leaf: true }));
  }
  if (last.level === 'category') {
    const q = runQuery({ metric: 'spend', groupBy: 'merchant', sort: 'value_desc', filter: f }, ctx);
    return q.rows.filter((r) => r.value !== 0).map((r) => node([...path, { level: 'store', key: r.key }], r.label, r.value, r.count, parentCents));
  }
  if (last.level === 'store' && metricOf(path) === 'spend') {
    const items = new Map<string, { label: string; cents: number; count: number; countsAs?: string }>();
    let none = 0, noneCount = 0;
    for (const t of listTxns(ctx, f, 100000)) {
      if (t.lines?.length && t.kind !== 'refund') {
        for (const l of t.lines) {
          const k = l.item.trim().toLowerCase();
          const cur = items.get(k) ?? { label: l.item.trim(), cents: 0, count: 0, countsAs: l.category && l.category !== t.category ? l.category : undefined };
          items.set(k, { ...cur, cents: cur.cents + l.cents, count: cur.count + 1 });
        }
      } else { none += -t.cents; noneCount += 1; }
    }
    const out = [...items.entries()].sort((a, b) => b[1].cents - a[1].cents).map(([k, v]) => node([...path, { level: 'item', key: k }], v.label, v.cents, v.count, parentCents, { leaf: true, countsAs: v.countsAs ? categoryLabel(v.countsAs) : undefined }));
    if (noneCount) out.push(node([...path, { level: 'item', key: '__none' }], 'No item detail yet', none, noneCount, parentCents, { leaf: true, hatch: true }));
    return out;
  }
  return [];
}

export const isLeaf = (n: GNode) => n.level === 'item' || !!n.leaf;
