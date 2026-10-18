import assert from 'node:assert/strict';
import { test } from 'node:test';

import { graphChildren, graphRoots } from '../src/core/graph';
import { runQuery } from '../src/core/queries';
import ledger from '../src/data/seed/ledger.sample.json';

const ctx = { txns: (ledger as any).txns, accounts: (ledger as any).accounts };

test('year total equals sum of months, months equal sum of their spending node', () => {
  const [year] = graphRoots(ctx);
  const months = graphChildren(ctx, year.path);
  assert.equal(months.reduce((s, m) => s + m.cents, 0), year.cents);
  assert.equal(year.cents, runQuery({ metric: 'spend' }, ctx).total);
  for (const m of months) {
    const spending = graphChildren(ctx, m.path).find((k) => k.key === 'spend')!;
    assert.equal(spending.cents, m.cents);
    const cats = graphChildren(ctx, spending.path);
    assert.equal(cats.reduce((s, c) => s + c.cents, 0), spending.cents);
    for (const c of cats.slice(0, 3)) {
      const stores = graphChildren(ctx, c.path);
      assert.equal(stores.reduce((s, x) => s + x.cents, 0), c.cents);
      const items = graphChildren(ctx, stores[0].path);
      assert.equal(items.reduce((s, x) => s + x.cents, 0), stores[0].cents);
    }
  }
});
