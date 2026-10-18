import { useMemo } from 'react';

import { HBars } from '@/charts/bars';
import { ScreenHeader } from '@/components/header';
import { dollars, runQuery } from '@/core/queries';
import { useRepo } from '@/data/repo';
import { Banner, Button, Card, Row, Screen, T } from '@/theme/ui';
import { router } from 'expo-router';

export default function Prices() {
  const { txns, ctx } = useRepo();
  const { compare, itemised, total } = useMemo(() => {
    const items = new Map<string, Map<string, { sum: number; n: number }>>();
    let itemisedCents = 0;
    for (const t of txns) {
      if (t.kind !== 'spend' || !t.lines?.length) continue;
      itemisedCents += -t.cents;
      for (const l of t.lines) {
        const k = l.item.trim().toLowerCase();
        const stores = items.get(k) ?? new Map();
        const cur = stores.get(t.merchant) ?? { sum: 0, n: 0 };
        stores.set(t.merchant, { sum: cur.sum + l.cents, n: cur.n + 1 });
        items.set(k, stores);
      }
    }
    const compare = [...items.entries()].filter(([, s]) => s.size >= 2).map(([item, s]) => {
      const rows = [...s.entries()].map(([store, v]) => ({ store, avg: Math.round(v.sum / v.n), n: v.n })).sort((a, b) => a.avg - b.avg);
      return { item, rows, save: rows[rows.length - 1].avg - rows[0].avg };
    }).sort((a, b) => b.save - a.save);
    return { compare, itemised: itemisedCents, total: runQuery({ metric: 'spend' }, ctx).total };
  }, [txns, ctx]);
  const needItems = runQuery({ metric: 'spend', groupBy: 'merchant', limit: 6, filter: { categories: ['mixed_retail', 'online_shopping', 'groceries'] } }, ctx).rows.map((r) => ({ key: r.key, label: r.label, value: r.value, hatch: true }));
  const pct = total ? Math.round((itemised / total) * 100) : 0;
  return (
    <Screen max={820}>
      <ScreenHeader back title="Prices" sub="Where the same item costs less." />
      <Banner tone={pct < 30 ? 'warn' : 'info'} title={`Item detail covers ${pct}% of your spending.`}>
        A price comparison needs the same item bought at two or more stores, with the price on the receipt. Only itemised receipts count; a bank line has no items.
      </Banner>
      {compare.length ? compare.map((c) => (
        <Card key={c.item} title={c.item}>
          {c.rows.map((r, i) => <Row key={r.store} label={`${r.store} (${r.n}x)`} value={dollars(r.avg)} tone={i === 0 ? 'good' : undefined} />)}
          <T size={13} bold>Buy at {c.rows[0].store}: about {dollars(c.save)} less per purchase than {c.rows[c.rows.length - 1].store}.</T>
        </Card>
      )) : (
        <Card title="Nothing to compare yet">
          <T size={13} tone="ink2">No item has been recorded at two different stores. Add receipts from these stores first, since they hold the most mixed baskets:</T>
          <HBars rows={needItems} />
          <Button label="Add a receipt" onPress={() => router.push({ pathname: '/import', params: { kind: 'receipt' } })} />
        </Card>
      )}
    </Screen>
  );
}
