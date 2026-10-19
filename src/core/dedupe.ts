// Duplicate detection. Pure TypeScript, no React, no network.
//
// The same purchase reaches the app in several shapes: a paper receipt and an e-receipt, a receipt and the card
// statement line, a cash entry for something already charged, two overlapping statements. Identical bytes are
// caught by the file fingerprint; everything here catches the cases where the bytes differ and the purchase is the same.
//
// Matching is deliberately strict: exact cents, a shared store word, the same day. A wrong "duplicate" silently loses
// real data, so anything uncertain is returned as 'possible' or 'weak' and the caller asks a person.
import type { ReceiptRecord } from './evidence';
import type { Txn } from './types';

const STOP = new Set(['the', 'and', 'inc', 'llc', 'corp', 'com', 'store', 'stores', 'shop', 'order', 'receipt', 'online', 'payment', 'purchase', 'pos', 'debit', 'credit', 'card', 'purchases']);
/** distinctive words of a name: lower case, 3+ letters or digits mixed, no filler, no bare numbers */
export const nameWords = (s?: string | null): string[] => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
/** true only when both sides name a store and share a word: an unknown store never matches */
export const sharesStore = (a?: string | null, b?: string | null) => { const x = new Set(nameWords(a)); return x.size > 0 && nameWords(b).some((w) => x.has(w)); };

const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const minutes = (t?: string | null): number | null => {
  const m = (t ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]);
  if (m[3]) { h = h % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0); }
  return h < 24 && min < 60 ? h * 60 + min : null;
};

// ---------------------------------------------------------------------------
// A receipt against receipts already stored (or earlier in the same batch)
// ---------------------------------------------------------------------------

export interface ReceiptKey {
  id: string; label: string;
  merchant?: string | null; date?: string | null; time?: string | null; totalCents?: number | null;
  orderRef?: string | null; cardLast4?: string | null; storeRef?: string | null; txnId?: string | null;
  /** how it was paid, as printed: what the app learns card digits from */
  paymentMethod?: string | null;
}
export const keyOf = (r: ReceiptRecord, id: string, label: string, txnId?: string | null): ReceiptKey => ({
  id, label, merchant: r.merchant, date: r.date, time: r.time, totalCents: r.totalCents, orderRef: r.orderRef, cardLast4: r.cardLast4, storeRef: r.storeRef, txnId: txnId ?? r.txnId ?? null, paymentMethod: r.paymentMethod,
});

export interface Sameness {
  /** same = treat as the same purchase unless told otherwise. possible = ask. */
  level: 'same' | 'possible';
  of: ReceiptKey;
  why: string;
}

/**
 * Is this receipt another document for a purchase we already hold? Requires the same total to the cent, a shared store word,
 * and the same day (one day apart is only 'possible': an online order dated before the pickup). A different time, card or store
 * number rules it out, so two coffees of the same price at different times stay separate.
 */
export function findSameReceipt(r: ReceiptRecord, others: ReceiptKey[]): Sameness | null {
  if (!r.totalCents || r.totalCents <= 0) return null;
  let possible: Sameness | null = null;
  for (const o of others) {
    if (!o.totalCents || Math.abs(o.totalCents - r.totalCents) > 1) continue;
    const a = minutes(r.time); const b = minutes(o.time);
    if (a != null && b != null && Math.abs(a - b) > 90) continue;
    if (r.cardLast4 && o.cardLast4 && r.cardLast4 !== o.cardLast4) continue;
    if (norm(r.storeRef) && norm(o.storeRef) && norm(r.storeRef) !== norm(o.storeRef)) continue;
    if (norm(r.orderRef).length >= 5 && norm(r.orderRef) === norm(o.orderRef)) return { level: 'same', of: o, why: 'same order number and total' };
    if (!r.date || !o.date || !sharesStore(r.merchant, o.merchant)) continue;
    const gap = dayGap(r.date, o.date);
    if (gap === 0) return { level: 'same', of: o, why: 'same store, day and total' };
    if (gap === 1 && !possible) possible = { level: 'possible', of: o, why: 'same store and total, one day apart' };
  }
  return possible;
}

// ---------------------------------------------------------------------------
// A receipt or cash entry against charges already in the ledger
// ---------------------------------------------------------------------------

/** Charges that could be this purchase: same amount to the cent, within `days`, and the same store or the same day. Includes earlier cash entries. */
export function likelyCharges(x: { totalCents?: number | null; date?: string | null; merchant?: string | null }, txns: Txn[], days = 4): Txn[] {
  if (!x.totalCents || x.totalCents <= 0 || !x.date) return [];
  return txns.filter((t) => (t.kind === 'spend' || t.kind === 'fee') && Math.abs(-t.cents - x.totalCents!) <= 1 && dayGap(t.date, x.date!) <= days
    && (t.date === x.date || sharesStore(x.merchant, `${t.merchant} ${t.description}`)));
}

// ---------------------------------------------------------------------------
// Statement rows against rows already stored for the same account
// ---------------------------------------------------------------------------

export interface RowIn { date?: string; description?: string; cents?: number }
export interface Twin {
  /** position of the row in the statement */
  index: number;
  existingId: string;
  /** the row would get the very same id: re-reading the same statement */
  sameId: boolean;
  /** description also agrees. false = only account, date and amount agree */
  strong: boolean;
}

const similar = (a: string, b: string) => {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  if (x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))) return true;
  const w = new Set(nameWords(a));
  return nameWords(b).some((t) => w.has(t));
};

/**
 * For each statement row, the stored row it duplicates, if any. One stored row answers at most one statement row, so two real
 * purchases of the same amount on the same day are not collapsed into one unless two were already stored.
 * `ids` are the ids the rows would be saved under.
 */
export function findTwins(rows: RowIn[], ids: string[], existing: Txn[], accountId: string): Twin[] {
  const pool = existing.filter((t) => t.accountId === accountId && !t.manual);
  const used = new Set<string>(); const out: Twin[] = [];
  const byId = new Map(pool.map((t) => [t.id, t]));
  rows.forEach((_, i) => { if (byId.has(ids[i]) && !used.has(ids[i])) { used.add(ids[i]); out.push({ index: i, existingId: ids[i], sameId: true, strong: true }); } });
  const done = new Set(out.map((t) => t.index));
  const byDayAmount = new Map<string, Txn[]>();
  for (const t of pool) { const k = `${t.date}|${t.cents}`; byDayAmount.set(k, [...(byDayAmount.get(k) ?? []), t]); }
  rows.forEach((r, i) => {
    if (done.has(i) || !r.date || !Number.isInteger(r.cents)) return;
    const same = (byDayAmount.get(`${r.date}|${r.cents}`) ?? []).filter((t) => !used.has(t.id));
    const hit = same.find((t) => similar(r.description ?? '', `${t.description} ${t.merchant}`)) ?? null;
    const pick = hit ?? same[0];
    if (!pick) return;
    used.add(pick.id);
    out.push({ index: i, existingId: pick.id, sameId: false, strong: !!hit });
  });
  return out.sort((a, b) => a.index - b.index);
}
