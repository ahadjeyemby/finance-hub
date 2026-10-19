import type { Account, Txn } from './types';

// Evidence: the documents and records behind a transaction. Pure mapping and matching, no network, no React.
// Money is always integer cents. Anything a document says that has no field yet goes into `raw` / `extra`, never dropped.

export interface ReceiptLine {
  item: string;
  cents: number;                 // line total, after any line discount
  qty?: number;
  unitCents?: number;
  code?: string;                 // SKU, item number, UPC fragment as printed
  discountCents?: number;
  taxable?: boolean;
  extra?: Record<string, unknown>;
}

/** Any extra charge a receipt adds between the items and the total apart from sales tax and tip: a service charge, delivery or bag fee, surcharge, automatic gratuity. One entry each, as printed. */
export interface ReceiptCharge {
  label: string;
  cents: number;
  /** the percentage printed beside it, e.g. 2 for "Service Charge (2.0%)" */
  rate?: number;
  /** service | delivery | fee | surcharge | gratuity | bag | other, when the reader could tell */
  type?: string;
}

export interface ReceiptRecord {
  kind?: 'store_receipt' | 'order_confirmation' | 'order_history';
  txnId?: string | null;
  merchant?: string;
  date?: string;                 // YYYY-MM-DD
  time?: string;                 // as printed, e.g. 14:32
  totalCents?: number;
  subtotalCents?: number;
  taxCents?: number;
  tipCents?: number;
  discountCents?: number;
  /** every other charge on the receipt (service, delivery, fees...), kept with its label and rate */
  charges?: ReceiptCharge[];
  /** part of the order paid with points, a gift card or store credit instead of the card, positive. The card was charged `totalCents`. */
  paidOtherCents?: number;
  paidOtherLabel?: string;
  /** the item count printed on the receipt, when there is one */
  itemCount?: number;
  /** the model that read the file */
  readBy?: string;
  /** what reading the file twice decided: shown as notes on the review card */
  corrections?: string[];
  /** a return the document shows: what Amazon-style order pages call the refund total, and the returned items (which also stay in `lines`, because they were bought) */
  refundCents?: number;
  refundedLines?: ReceiptLine[];
  currency?: string;
  paymentMethod?: string;
  cardLast4?: string;
  storeAddress?: string;
  storeRef?: string;
  orderRef?: string;
  lines: ReceiptLine[];
  sourceFile?: string;
  sha256?: string;
  origin?: 'app_upload' | 'offline_extract' | 'typed';
  capturedAt?: string;
  notes?: string;
  raw?: Record<string, unknown>;
  /** the person's answer when this looks like another document for a purchase already held */
  dup?: 'extra' | 'different';
  /** id of the stored receipt this one is another document for (kept in raw, no column needed) */
  duplicateOf?: string;
}

export interface StatementRecord {
  id: string;
  accountId: string | null;
  institution?: string;
  last4?: string;
  product?: string;
  label?: string;
  periodFrom?: string;
  periodTo?: string;
  issuedOn?: string;
  dueOn?: string;
  openingCents?: number;
  closingCents?: number;
  totals?: Record<string, number>;
  terms?: Record<string, unknown>;
  reconciled?: boolean;
  reconciliation?: unknown;
  sourceFile?: string;
  sha256?: string;
  pages?: number;
  raw?: Record<string, unknown>;
}

export interface RawRecord {
  txnId: string;
  statementId?: string;
  lineNo?: number;
  postedDate?: string;
  sourceFile?: string;
  row: Record<string, unknown>;
}

const n = <T,>(v: T | undefined | null): T | null => (v === undefined ? null : v);

export const statementToRow = (s: StatementRecord, storagePath: string | null) => ({
  id: s.id, account_id: s.accountId ?? null, institution: n(s.institution), last4: n(s.last4), product: n(s.product), label: n(s.label), period_from: n(s.periodFrom), period_to: n(s.periodTo), issued_on: n(s.issuedOn), due_on: n(s.dueOn),
  opening_balance_cents: n(s.openingCents), closing_balance_cents: n(s.closingCents), totals: s.totals ?? {}, terms: s.terms ?? {},
  reconciled: n(s.reconciled), reconciliation: n(s.reconciliation), source_file: n(s.sourceFile), sha256: n(s.sha256), storage_path: storagePath, pages: n(s.pages), raw: s.raw ?? {},
});

export const rawToRow = (r: RawRecord) => ({
  txn_id: r.txnId, statement_id: n(r.statementId), line_no: n(r.lineNo), posted_date: n(r.postedDate), source_file: n(r.sourceFile), row: r.row,
});

export const receiptToRow = (r: ReceiptRecord, storagePath: string | null, txnId: string | null) => ({
  kind: r.kind ?? 'store_receipt', txn_id: txnId, storage_path: storagePath, merchant: n(r.merchant), date: n(r.date), time: n(r.time),
  total_cents: n(r.totalCents), subtotal_cents: n(r.subtotalCents), tax_cents: n(r.taxCents), tip_cents: n(r.tipCents), discount_cents: n(r.discountCents),
  currency: r.currency ?? 'USD', payment_method: n(r.paymentMethod), card_last4: n(r.cardLast4), store_address: n(r.storeAddress), store_ref: n(r.storeRef), order_ref: n(r.orderRef),
  lines: r.lines, source_file: n(r.sourceFile), sha256: n(r.sha256), origin: r.origin ?? 'app_upload', captured_at: n(r.capturedAt), raw: { ...(r.raw ?? {}), ...(r.notes ? { notes: r.notes } : {}), ...(r.duplicateOf ? { duplicateOf: r.duplicateOf } : {}),
    ...(r.itemCount ? { itemCount: r.itemCount } : {}), ...(r.charges?.length ? { charges: r.charges } : {}), ...(r.paidOtherCents ? { paidOther: { cents: r.paidOtherCents, label: r.paidOtherLabel ?? null } } : {}), ...(r.refundCents ? { refund: { totalCents: r.refundCents, lines: r.refundedLines ?? [] } } : {}) },
});

/** What a receipt row looks like when read back, shaped for the evidence pop-up. */
export interface ReceiptView {
  id: string; kind: string; merchant: string | null; date: string | null; time: string | null; totalCents: number | null; subtotalCents: number | null; taxCents: number | null;
  tipCents: number | null; discountCents: number | null; paymentMethod: string | null; cardLast4: string | null; storeAddress: string | null; storeRef: string | null; orderRef: string | null;
  lines: ReceiptLine[]; sourceFile: string | null; storagePath: string | null; origin: string; uploadedAt: string; capturedAt: string | null;
  /** extra charges (service, delivery, fees), read back from the receipt's raw data */
  charges: ReceiptCharge[];
}
export const rowToReceipt = (r: Record<string, any>): ReceiptView => ({
  id: r.id, kind: r.kind, merchant: r.merchant, date: r.date, time: r.time, totalCents: r.total_cents, subtotalCents: r.subtotal_cents, taxCents: r.tax_cents, tipCents: r.tip_cents,
  discountCents: r.discount_cents, paymentMethod: r.payment_method, cardLast4: r.card_last4, storeAddress: r.store_address, storeRef: r.store_ref, orderRef: r.order_ref,
  lines: Array.isArray(r.lines) ? r.lines : [], sourceFile: r.source_file, storagePath: r.storage_path, origin: r.origin, uploadedAt: r.created_at, capturedAt: r.captured_at,
  charges: Array.isArray(r.raw?.charges) ? r.raw.charges : [],
});

export interface StatementView {
  id: string; label: string | null; periodFrom: string | null; periodTo: string | null; issuedOn: string | null; sourceFile: string | null; storagePath: string | null;
  openingCents: number | null; closingCents: number | null; reconciled: boolean | null; extractedAt: string;
}
export const rowToStatement = (r: Record<string, any>): StatementView => ({
  id: r.id, label: r.label, periodFrom: r.period_from, periodTo: r.period_to, issuedOn: r.issued_on, sourceFile: r.source_file, storagePath: r.storage_path,
  openingCents: r.opening_balance_cents, closingCents: r.closing_balance_cents, reconciled: r.reconciled, extractedAt: r.extracted_at,
});

const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

const norm = (s: string) => words(s).join(' ');
/** "this receipt's store name" > "this charge's merchant": a pair the person has already confirmed as one store */
export const aliasKey = (receiptMerchant: string, chargeMerchant: string) => `${norm(receiptMerchant)}>${norm(chargeMerchant)}`;

export interface MatchOptions {
  /** to compare the card digits on the receipt with the card the charge is on */
  accounts?: Account[];
  /** store-name pairs the person has confirmed before (see learn.ts) */
  aliases?: ReadonlySet<string>;
  /** true once enough links on this card were confirmed that a likely match is applied without asking */
  trusted?: (accountId: string) => boolean;
}
export interface Match {
  txnId: string | null;
  candidates: string[];
  reason: string;
  /** a charge that probably is this receipt, but not sure enough to link unasked: the same amount and date, on the receipt's card, under another store name */
  likely?: string | null;
}

/**
 * Find the ledger row a receipt belongs to. Confident only when exactly one charge matches:
 * same amount (within a cent), within `days` of the receipt date, and (when both name a store) sharing a word with it,
 * or a store name the person has already confirmed for that charge's name.
 * An order number that equals txn.ref wins outright. The card digits break ties, and when the store names differ but the receipt's card is the
 * charge's card, that single charge is offered as `likely`, and linked outright once that card has enough confirmed links.
 */
export function matchReceipt(r: ReceiptRecord, txns: Txn[], days = 4, opts: MatchOptions = {}): Match {
  if (r.orderRef) {
    const byRef = txns.filter((t) => t.ref && t.ref === r.orderRef);
    if (byRef.length === 1) return { txnId: byRef[0].id, candidates: [byRef[0].id], reason: 'order number' };
  }
  if (r.totalCents == null || !r.date) return { txnId: null, candidates: [], reason: 'receipt has no total or date' };
  const spend = txns.filter((t) => (t.kind === 'spend' || t.kind === 'fee') && Math.abs(-t.cents - r.totalCents!) <= 1 && dayGap(t.date, r.date!) <= days);
  const rw = new Set(words(r.merchant ?? ''));
  const nameOk = (t: Txn) => rw.size === 0 || words(`${t.merchant} ${t.description}`).some((w) => rw.has(w)) || !!(r.merchant && opts.aliases?.has(aliasKey(r.merchant, t.merchant)));
  const onCard = (t: Txn) => !!r.cardLast4 && opts.accounts?.find((a) => a.id === t.accountId)?.last4 === r.cardLast4;
  const named = spend.filter(nameOk);
  const pool = named.length ? named : [];
  if (pool.length === 1) return { txnId: pool[0].id, candidates: [pool[0].id], reason: 'amount, date and store' };
  // two charges fit: the one on the receipt's own card, if only one is
  const cardPool = pool.filter(onCard);
  if (pool.length > 1 && cardPool.length === 1) return { txnId: cardPool[0].id, candidates: pool.map((t) => t.id), reason: 'amount, store and your card' };
  // repeat purchases (two identical fuel stops a few days apart): the one charge dated the same day as the receipt wins, if only one is
  const sameDay = pool.filter((t) => t.date === r.date);
  if (pool.length > 1 && sameDay.length === 1) return { txnId: sameDay[0].id, candidates: pool.map((t) => t.id), reason: 'amount, store and exact date' };
  // no store name in common (the bank prints its own, often garbled): the receipt's card can still point at one charge
  if (!named.length) {
    const byCard = spend.filter(onCard);
    if (byCard.length === 1) {
      const t = byCard[0]; const gap = Math.round(dayGap(t.date, r.date!));
      const why = `same amount, ${gap === 0 ? 'the same day' : `${gap} day${gap > 1 ? 's' : ''} apart`}, paid with your card ending ${r.cardLast4}`;
      if (opts.trusted?.(t.accountId)) return { txnId: t.id, candidates: [t.id], reason: why };
      return { txnId: null, candidates: [t.id], reason: why, likely: t.id };
    }
  }
  return { txnId: null, candidates: (pool.length ? pool : spend).map((t) => t.id), reason: pool.length > 1 ? 'several charges match' : spend.length ? 'amount matches but the store name does not' : 'no charge with that amount near that date' };
}

/**
 * Credits to the card that may be the refund a receipt shows: a refund-kind row with money coming in, no larger than the refund total,
 * dated on or after the order within 90 days, from a store sharing a word with the receipt's. Part of a refund can go back to points,
 * so a smaller credit is normal. Only ever shown as a hint: nothing is linked or changed by it.
 */
export function likelyRefundCredits(r: ReceiptRecord, txns: Txn[], days = 90): Txn[] {
  if (!r.refundCents || !r.date) return [];
  const rw = new Set(words(r.merchant ?? ''));
  return txns.filter((t) => t.kind === 'refund' && t.cents > 0 && t.cents <= r.refundCents! + 1 && t.date >= r.date! && dayGap(t.date, r.date!) <= days
    && (rw.size === 0 || words(`${t.merchant} ${t.description}`).some((w) => rw.has(w))));
}

/** Item lines for the app's overlay: items, then tax, tip and discounts, then "Other" so the lines always add up to the charge. */
export function receiptToLines(r: ReceiptRecord, chargeCents: number): { item: string; cents: number }[] {
  const out = r.lines.map((l) => ({ item: l.item, cents: l.cents }));
  if (r.taxCents) out.push({ item: 'Sales tax', cents: r.taxCents });
  if (r.tipCents) out.push({ item: 'Tip', cents: r.tipCents });
  for (const c of r.charges ?? []) out.push({ item: c.label, cents: c.cents });
  if (r.discountCents) out.push({ item: 'Discount', cents: -Math.abs(r.discountCents) });
  const sum = out.reduce((s, l) => s + l.cents, 0);
  if (sum > chargeCents) return [];          // does not add up: keep the receipt as evidence, do not split the transaction
  if (sum < chargeCents) out.push({ item: 'Other (not itemised)', cents: chargeCents - sum });
  return out;
}
