// What the app has learned from what the person already confirmed. There is no separate memory to keep in step: every saved receipt records its
// payment method, card digits and the charge it was linked to, so habits are counted from that history. Pure TypeScript, no React, no network.
import { aliasKey } from './evidence';
import type { ReceiptRecord } from './evidence';
import type { ReceiptKey } from './dedupe';
import type { Account, Txn } from './types';

/** Confirmations needed before something is filled in or linked without asking. Below this the app proposes and the person confirms. */
export const AUTO_AFTER = 5;

const BRANDS: [RegExp, string][] = [
  [/master\s?card|\bmcard\b|\bmc\b/i, 'mastercard'], [/visa/i, 'visa'], [/amex|american express/i, 'amex'], [/discover/i, 'discover'], [/debit/i, 'debit'],
];
/** "MASTERCARD CREDIT TEND", "Mastercard (credit card)" and "WMP MCARD TEND (Walmart Pay)" all mean one card brand. null when the method names no card (cash, a wallet). */
export function methodKey(method?: string | null): string | null {
  if (!method) return null;
  for (const [re, key] of BRANDS) if (re.test(method)) return key;
  return null;
}

export interface Habit {
  /** the card digits used most often with this payment method */
  value: string;
  /** how many earlier receipts used them, out of `total` that named a card for this method */
  count: number; total: number;
  /** the other digits seen with this method, most used first */
  others: { value: string; count: number }[];
  /** enough confirmations, and almost always the same card: fill it in without asking */
  auto: boolean;
}

/** Which card digits go with this payment method, from earlier receipts. null when there is nothing to go on. */
export function learnCard(history: Pick<ReceiptKey, 'paymentMethod' | 'cardLast4'>[], method?: string | null): Habit | null {
  const key = methodKey(method);
  if (!key) return null;
  const seen = new Map<string, number>();
  for (const h of history) if (/^\d{4}$/.test(h.cardLast4 ?? '') && methodKey(h.paymentMethod) === key) seen.set(h.cardLast4!, (seen.get(h.cardLast4!) ?? 0) + 1);
  const ranked = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const total = ranked.reduce((t, [, n]) => t + n, 0);
  const [value, count] = ranked[0];
  return { value, count, total, others: ranked.slice(1).map(([v, n]) => ({ value: v, count: n })), auto: count >= AUTO_AFTER && count / total >= 0.9 };
}

/** Fill in missing card digits from the habit, but only once it is established. The note says where they came from so the person can undo it. */
export function applyCardHabit(r: ReceiptRecord, history: Pick<ReceiptKey, 'paymentMethod' | 'cardLast4'>[]): ReceiptRecord {
  if (r.cardLast4 || !r.paymentMethod) return r;
  const h = learnCard(history, r.paymentMethod);
  if (!h?.auto) return r;
  return { ...r, cardLast4: h.value, corrections: [...(r.corrections ?? []), `Card digits ${h.value} were not printed. They were filled in from your ${h.count} earlier ${methodKey(r.paymentMethod)} receipts that used it. Change them under Check or edit details if this one was a different card.`] };
}

/** Store names a receipt used for a charge the person linked it to ("Suvidha International Market" for "SUMDHA INTL GROCERY"): once confirmed, that pair counts as the same store. */
export function learnAliases(receipts: ReceiptKey[], txns: Txn[]): Set<string> {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const out = new Set<string>();
  for (const r of receipts) {
    const t = r.txnId ? byId.get(r.txnId) : undefined;
    if (t && r.merchant) out.add(aliasKey(r.merchant, t.merchant));
  }
  return out;
}

/** Per account: how many saved receipts on that card are linked to a charge on it. At AUTO_AFTER or more, a likely match on that card is linked without asking. */
export function linkTrust(receipts: ReceiptKey[], txns: Txn[], accounts: Account[]): Map<string, number> {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const out = new Map<string, number>();
  for (const r of receipts) {
    const t = r.txnId ? byId.get(r.txnId) : undefined;
    const a = t ? accounts.find((x) => x.id === t.accountId) : undefined;
    if (t && a && r.cardLast4 && a.last4 === r.cardLast4) out.set(a.id, (out.get(a.id) ?? 0) + 1);
  }
  return out;
}
