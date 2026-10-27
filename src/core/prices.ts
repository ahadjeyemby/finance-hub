import type { Txn } from './types';

// Where the same item costs less, from receipt lines only (a bank line has no items). Items are matched by name, so the same product written
// differently on two receipts is two items; every figure is from what was actually paid, nothing is estimated.

export interface PriceRow { store: string; avg: number; n: number }
export interface ItemCompare {
  key: string;
  /** the name as it was first written on a receipt */
  item: string;
  /** cheapest first */
  rows: PriceRow[];
  /** the cheapest store's price against the next cheapest */
  save: number;
  /** how many times it was bought, at any store */
  bought: number;
  /** what it cost on average across every purchase */
  paidAvg: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function compareItems(txns: Txn[]): { compare: ItemCompare[]; itemisedCents: number } {
  const items = new Map<string, { item: string; stores: Map<string, { sum: number; n: number }> }>();
  let itemisedCents = 0;
  for (const t of txns) {
    if (t.kind !== 'spend' || !t.lines?.length) continue;
    itemisedCents += -t.cents;
    for (const l of t.lines) {
      if (!l.item.trim() || l.cents <= 0) continue;
      const k = norm(l.item);
      const e = items.get(k) ?? { item: l.item.trim(), stores: new Map() };
      const cur = e.stores.get(t.merchant) ?? { sum: 0, n: 0 };
      e.stores.set(t.merchant, { sum: cur.sum + l.cents, n: cur.n + 1 });
      items.set(k, e);
    }
  }
  const compare = [...items.entries()].filter(([, e]) => e.stores.size >= 2).map(([key, e]) => {
    const rows = [...e.stores.entries()].map(([store, v]) => ({ store, avg: Math.round(v.sum / v.n), n: v.n })).sort((a, b) => a.avg - b.avg || a.store.localeCompare(b.store));
    const all = [...e.stores.values()];
    const bought = all.reduce((s, v) => s + v.n, 0);
    return { key, item: e.item, rows, save: rows[1].avg - rows[0].avg, bought, paidAvg: Math.round(all.reduce((s, v) => s + v.sum, 0) / bought) };
  }).sort((a, b) => b.save - a.save || a.key.localeCompare(b.key));
  return { compare, itemisedCents };
}

/** The items bought most often that have prices at two or more stores. */
export const usualBasket = (compare: ItemCompare[], size = 5) => [...compare].sort((a, b) => b.bought - a.bought || a.key.localeCompare(b.key)).slice(0, size);

/**
 * The one store where the usual basket costs least against what was paid for it: for every store, the items in the basket it has a price for,
 * each counted at (average paid − that store's price), so an item that is dearer there counts against it. Only a store that prices at least
 * half of the basket is considered, and only a total saving above zero is reported. null when no store qualifies.
 */
export function bestStore(basket: ItemCompare[]): { store: string; covers: number; cheapestFor: number; of: number; savingPerBasket: number } | null {
  const stores = new Set(basket.flatMap((it) => it.rows.map((r) => r.store)));
  const need = Math.ceil(basket.length / 2);
  let best: { store: string; covers: number; cheapestFor: number; of: number; savingPerBasket: number } | null = null;
  for (const store of [...stores].sort()) {
    let covers = 0, cheapestFor = 0, saving = 0;
    for (const it of basket) {
      const row = it.rows.find((r) => r.store === store);
      if (!row) continue;
      covers++;
      if (it.rows[0].store === store) cheapestFor++;
      saving += it.paidAvg - row.avg;
    }
    if (covers < need || saving <= 0) continue;
    if (!best || saving > best.savingPerBasket) best = { store, covers, cheapestFor, of: basket.length, savingPerBasket: saving };
  }
  return best;
}
