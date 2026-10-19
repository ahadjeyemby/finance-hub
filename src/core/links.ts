// Links between receipts and statement charges. Pure TypeScript: no React, no network.
//
// A link is a stored relationship (receipt_links), many to many: a receipt can explain several charges and a charge can have several receipts.
// Nothing here guesses silently. The engine only proposes; each proposal says how sure it is and why, and the person's choices are kept as
// confirmed links and as "no link expected" flags (cash, another account, a charge that never has a receipt).
import { findSameReceipt, keyOf } from './dedupe';
import type { ReceiptKey } from './dedupe';
import { matchReceipt, receiptToLines } from './evidence';
import type { MatchOptions, ReceiptRecord } from './evidence';
import { AUTO_AFTER } from './learn';
import type { Account, Txn } from './types';

export type LinkRole = 'primary' | 'extra' | 'refund' | 'split';
export type LinkMethod = 'order_number' | 'card' | 'store' | 'confirmed' | 'manual';
export type NoLinkReason = 'cash' | 'other_account' | 'gift_card' | 'no_receipt' | 'other';

export interface Link {
  id?: string; receiptId: string; txnId: string;
  /** how much of the charge this receipt accounts for; null or missing = all of it */
  amountCents?: number | null;
  role: LinkRole; method: LinkMethod; reason?: string | null;
  /** the person approved it or chose it themselves */
  confirmed: boolean;
}
export interface LinkFlag { kind: 'receipt' | 'txn'; refId: string; reason: NoLinkReason; note?: string | null }
export type StoredReceipt = ReceiptRecord & { id: string };

export const NO_LINK_LABEL: Record<NoLinkReason, string> = {
  cash: 'Paid in cash', other_account: 'Paid from another account', gift_card: 'Paid with a gift card or points', no_receipt: 'No receipt expected', other: 'Something else',
};
/** The reasons that make sense for a receipt, and for a charge. */
export const RECEIPT_NO_LINK: NoLinkReason[] = ['cash', 'other_account', 'gift_card', 'other'];
export const CHARGE_NO_LINK: NoLinkReason[] = ['no_receipt', 'other'];

export interface Proposal {
  receiptId: string; txnId: string; role: LinkRole; method: LinkMethod; reason: string;
  /** strong evidence: safe to store as an automatic link. false = show it and let the person confirm. */
  sure: boolean;
}

export type UnlinkedWhy = 'no_total_or_date' | 'outside_statements' | 'card_not_tracked' | 'several_charges' | 'no_charge';
export interface Unlinked { receiptId: string; why: UnlinkedWhy; text: string; candidates: string[] }

export interface PlanInput {
  receipts: StoredReceipt[]; txns: Txn[]; links: Link[]; flags: LinkFlag[]; accounts: Account[];
  /** store-name pairs the person confirmed before, and per-card counts of confirmed links (see learn.ts) */
  aliases?: ReadonlySet<string>; trust?: ReadonlyMap<string, number>;
}
export interface Plan {
  proposals: Proposal[];
  /** receipts with no link, no flag and no proposal: what is missing and why */
  receiptsWithoutCharge: Unlinked[];
  /** charges that should have a receipt but have none, none flagged and none proposed */
  chargesWithoutReceipt: string[];
}

const isCharge = (t: Txn) => t.kind === 'spend' || t.kind === 'fee';
const dayMs = 86400000;
const gap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / dayMs;

const methodOf = (reason: string): LinkMethod => (reason === 'order number' ? 'order_number' : /card/.test(reason) ? 'card' : 'store');

/** Stored receipts in the small form the duplicate check needs, each with the charge it is linked to (its primary link). */
export function storedKeys(d: { links: Link[]; receipts: StoredReceipt[] }): ReceiptKey[] {
  return d.receipts.map((r) => keyOf(r, r.id, r.sourceFile ?? 'a stored receipt', (d.links.find((l) => l.receiptId === r.id && l.role !== 'extra') ?? d.links.find((l) => l.receiptId === r.id))?.txnId ?? null));
}

/** Links whose charge is no longer in the ledger (after a wipe and reimport, or a deleted cash entry). Only meaningful once the ledger has loaded. */
export const orphanLinks = (links: Link[], txns: Txn[]): Link[] => { const ids = new Set(txns.map((t) => t.id)); return links.filter((l) => !ids.has(l.txnId)); };

/** Why a receipt has no charge, from what the loaded statements cover. */
export function explainUnlinked(r: ReceiptRecord, txns: Txn[], accounts: Account[], candidates: string[] = []): { why: UnlinkedWhy; text: string } {
  if (r.totalCents == null || !r.date) return { why: 'no_total_or_date', text: 'The receipt has no total or no date, so it cannot be matched.' };
  if (candidates.length > 1) return { why: 'several_charges', text: `${candidates.length} charges fit this receipt. Choose the right one.` };
  const real = accounts.filter((a) => a.type !== 'cash');
  const covered = real.some((a) => r.date! >= shift(a.coverage.from, -5) && r.date! <= shift(a.coverage.to, 5));
  if (real.length && !covered) return { why: 'outside_statements', text: `No statement you have loaded covers ${r.date}. Import the statement for that month, or mark it as paid another way.` };
  const tracked = real.filter((a) => a.last4);
  if (r.cardLast4 && tracked.length && !tracked.some((a) => a.last4 === r.cardLast4)) return { why: 'card_not_tracked', text: `The card ending ${r.cardLast4} is not one of your loaded accounts. Import its statement, or mark it as paid another way.` };
  return { why: 'no_charge', text: `No charge of ${(r.totalCents / 100).toFixed(2)} near ${r.date} on your loaded statements.` };
}
const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * dayMs).toISOString().slice(0, 10);

/**
 * What to link, given what is stored. Receipts without a link are matched against charges that have no receipt yet, in rounds: a receipt
 * that clearly fits one charge takes it, and two receipts that want the same charge are settled by the closer date, so identical purchases
 * are never both given to one charge. A receipt that is another document for a purchase already linked becomes an "extra" link to the same
 * charge. Receipts and charges the person flagged are left alone.
 */
export function planLinks(input: PlanInput): Plan {
  const { receipts, txns, links, flags, accounts } = input;
  const linkedReceipts = new Set(links.map((l) => l.receiptId));
  const flaggedReceipts = new Set(flags.filter((f) => f.kind === 'receipt').map((f) => f.refId));
  const flaggedTxns = new Set(flags.filter((f) => f.kind === 'txn').map((f) => f.refId));
  const taken = new Set(links.filter((l) => l.role === 'primary' || l.role === 'split').map((l) => l.txnId));
  const opts: MatchOptions = { accounts, aliases: input.aliases, trusted: (id) => (input.trust?.get(id) ?? 0) >= AUTO_AFTER };

  const proposals: Proposal[] = [];
  let pending = receipts.filter((r) => !linkedReceipts.has(r.id) && !flaggedReceipts.has(r.id));

  // another document for a purchase that already has a receipt: attach it to the same charge as an extra, not as a second purchase
  const linkedKeys: ReceiptKey[] = receipts.filter((r) => linkedReceipts.has(r.id)).map((r) => keyOf(r, r.id, r.sourceFile ?? r.merchant ?? 'a receipt', links.find((l) => l.receiptId === r.id && l.role !== 'extra')?.txnId ?? null));
  const extras = new Set<string>();
  for (const r of pending) {
    const same = findSameReceipt(r, linkedKeys);
    if (same?.level === 'same' && same.of.txnId) { proposals.push({ receiptId: r.id, txnId: same.of.txnId, role: 'extra', method: 'store', reason: `another document for the same purchase (${same.why})`, sure: true }); extras.add(r.id); }
  }
  pending = pending.filter((r) => !extras.has(r.id));

  let free = txns.filter((t) => isCharge(t) && !taken.has(t.id));
  const assigned = new Map<string, Proposal>();
  for (let round = 0; round < 6; round++) {
    const wants = new Map<string, { r: StoredReceipt; why: string; days: number }[]>();
    for (const r of pending) {
      if (assigned.has(r.id)) continue;
      const m = matchReceipt(r, free, 4, opts);
      if (!m.txnId) continue;
      const t = free.find((x) => x.id === m.txnId)!;
      wants.set(t.id, [...(wants.get(t.id) ?? []), { r, why: m.reason, days: r.date ? gap(t.date, r.date) : 99 }]);
    }
    if (!wants.size) break;
    const used = new Set<string>();
    for (const [txnId, list] of wants) {
      const best = [...list].sort((a, b) => a.days - b.days || a.r.id.localeCompare(b.r.id))[0];
      assigned.set(best.r.id, { receiptId: best.r.id, txnId, role: 'primary', method: methodOf(best.why), reason: best.why, sure: true });
      used.add(txnId);
    }
    free = free.filter((t) => !used.has(t.id));
  }
  proposals.push(...assigned.values());

  const left = pending.filter((r) => !assigned.has(r.id));
  const receiptsWithoutCharge: Unlinked[] = [];
  const suggested = new Set<string>();
  for (const r of left) {
    const m = matchReceipt(r, free, 4, opts);
    if (m.likely && !suggested.has(m.likely)) {
      suggested.add(m.likely);
      proposals.push({ receiptId: r.id, txnId: m.likely, role: 'primary', method: 'card', reason: m.reason, sure: false });
      continue;
    }
    receiptsWithoutCharge.push({ receiptId: r.id, candidates: m.candidates, ...explainUnlinked(r, txns, accounts, m.candidates) });
  }

  const hasLink = new Set([...links.map((l) => l.txnId), ...proposals.map((p) => p.txnId)]);
  const chargesWithoutReceipt = txns.filter((t) => isCharge(t) && !t.manual && !hasLink.has(t.id) && !flaggedTxns.has(t.id)).map((t) => t.id);
  return { proposals, receiptsWithoutCharge, chargesWithoutReceipt };
}

/**
 * The transaction list with the links applied: a charge with a receipt knows it (receiptId), takes its item lines from the receipt when it has
 * none of its own, and a charge flagged "no receipt expected" says why. Derived every time, never stored on the transaction.
 */
export function applyLinks(txns: Txn[], links: Link[], receipts: ReadonlyMap<string, ReceiptRecord>, flags: LinkFlag[] = []): Txn[] {
  if (!links.length && !flags.length) return txns;
  const byTxn = new Map<string, Link[]>();
  for (const l of links) byTxn.set(l.txnId, [...(byTxn.get(l.txnId) ?? []), l]);
  const why = new Map(flags.filter((f) => f.kind === 'txn').map((f) => [f.refId, f.reason]));
  return txns.map((t) => {
    const ls = byTxn.get(t.id);
    const flag = why.get(t.id);
    if (!ls && !flag) return t;
    const primary = ls?.find((l) => l.role === 'primary' || l.role === 'split') ?? ls?.[0];
    const rec = primary ? receipts.get(primary.receiptId) : undefined;
    const lines = !t.lines?.length && rec ? receiptToLines(rec, -t.cents) : [];
    return { ...t, ...(primary ? { receiptId: primary.receiptId } : {}), ...(lines.length ? { lines } : {}), ...(flag && !primary ? { receiptFlag: flag } : {}) };
  });
}
