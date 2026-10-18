import type { Block, ReportSpec } from '@/core/report';
import type { Filter, QuerySpec } from '@/core/queries';

/** Apply the app's Personal/Business scope to every query inside a report. */
export function withScope(spec: ReportSpec, scope: Filter['scope']): ReportSpec {
  if (!scope || scope === 'all') return spec;
  const q = (x: QuerySpec): QuerySpec => ({ ...x, filter: { ...(x.filter ?? {}), scope } });
  const blocks: Block[] = spec.blocks.map((b) => {
    if (b.type === 'kpis') return { ...b, items: b.items.map((i) => ({ ...i, query: q(i.query) })) };
    if (b.type === 'chart') return { ...b, query: q(b.query) };
    if (b.type === 'table') return { ...b, query: b.query ? q(b.query) : undefined, filter: { ...(b.filter ?? {}), scope } };
    return b;
  });
  return { ...spec, blocks };
}
