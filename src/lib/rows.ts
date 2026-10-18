import type { BarRow } from '@/charts/bars';
import { categoryLabel } from '@/core/categories';
import { monthEnd } from '@/core/dates';
import { runQuery } from '@/core/queries';
import type { Ctx, Filter, GroupBy, Row } from '@/core/queries';

const HATCH = new Set(['mixed_retail', 'online_shopping']);

/** `completeTo`: last day every statement covers. Periods that end after it are hatched as incomplete. */
export function toBarRows(rows: Row[], group: GroupBy | undefined, completeTo?: string): BarRow[] {
  const partial = (key: string) => !!completeTo && ((group === 'month' && monthEnd(key) > completeTo) || (group === 'week' && key > completeTo) || (group === 'day' && key > completeTo));
  return rows.map((r) => ({ key: r.key, label: group === 'category' ? categoryLabel(r.key) : r.label, long: r.long, value: r.value, hatch: (group === 'category' && HATCH.has(r.key)) || partial(r.key) }));
}

export function categoryRows(ctx: Ctx, filter: Filter, limit = 6): BarRow[] {
  const q = runQuery({ metric: 'spend', groupBy: 'category', sort: 'value_desc', limit, foldOther: true, filter }, ctx);
  return toBarRows(q.rows, 'category');
}
