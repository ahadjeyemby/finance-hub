// Reads and writes the receipt_links and link_flags tables (migration 0003). The rules live in core/links.ts; this file only moves rows.
import { rowToRecord } from '@/core/evidence';
import type { Link, LinkFlag, NoLinkReason, StoredReceipt } from '@/core/links';
import { contributorClearFlag, contributorDeleteLink, contributorSaveLinks, contributorSetFlag, fetchContributorSnapshot } from './contributor';
import { contributorOwner, meId } from './scope';
import { supabase } from './supabase';

const db = () => { if (!supabase) throw new Error('No database is connected.'); return supabase; };
const PAGE = 1000;

export interface LinkData { links: Link[]; receipts: StoredReceipt[]; flags: LinkFlag[] }
export const NO_LINKS: LinkData = { links: [], receipts: [], flags: [] };

// the receipt columns linking needs: everything but the full reader output, of which only a few fields are used
const RECEIPT_COLS = 'id, kind, merchant, date, time, total_cents, subtotal_cents, tax_cents, tip_cents, discount_cents, currency, payment_method, card_last4, store_address, store_ref, order_ref, lines, source_file, sha256, origin, captured_at, charges:raw->charges, paid_other:raw->paidOther, refund:raw->refund, item_count:raw->itemCount';

async function pages<T>(table: string, cols: string, order: string, owner: string = meId()): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select(cols).eq('user_id', owner).order(order).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

const rowToLink = (r: Record<string, any>): Link => ({ id: r.id, receiptId: r.receipt_id, txnId: r.txn_id, amountCents: r.amount_cents, role: r.role, method: r.method, reason: r.reason, confirmed: !!r.confirmed });
const linkToRow = (l: Link) => ({ receipt_id: l.receiptId, txn_id: l.txnId, amount_cents: l.amountCents ?? null, role: l.role, method: l.method, reason: l.reason ?? null, confirmed: l.confirmed });

/** Everything linking needs, or null when the tables are not there yet (migration 0003 not run) or there is no connection. */
export async function fetchLinkData(owner: string = meId()): Promise<LinkData | null> {
  if (!supabase) return null;
  try {
    // a Contributor gets the links that belong to spending, with the rest of what they may see
    if (contributorOwner()) return (await fetchContributorSnapshot()).links;
    const [links, flags, receipts] = await Promise.all([
      pages<Record<string, any>>('receipt_links', '*', 'created_at', owner),
      pages<Record<string, any>>('link_flags', '*', 'created_at', owner),
      pages<Record<string, any>>('receipts', RECEIPT_COLS, 'created_at', owner),
    ]);
    return {
      links: links.map(rowToLink),
      flags: flags.map((f) => ({ kind: f.kind, refId: f.ref_id, reason: f.reason, note: f.note })),
      receipts: receipts.map((r) => rowToRecord({ ...r, raw: { charges: r.charges, paidOther: r.paid_other, refund: r.refund, itemCount: r.item_count } })),
    };
  } catch { return null; }
}

/** Store links. A receipt and a charge are linked once: saving the same pair again updates it. */
export async function saveLinks(links: Link[], owner?: string): Promise<void> {
  if (!links.length) return;
  if (contributorOwner()) return contributorSaveLinks(links.map(linkToRow));
  const { error } = await db().from('receipt_links').upsert(links.map(linkToRow).map((r) => (owner ? { ...r, user_id: owner } : r)), { onConflict: 'receipt_id,txn_id' });
  if (error) throw new Error(`Could not save the link: ${error.message}`);
}

export async function removeLink(receiptId: string, txnId: string): Promise<void> {
  if (contributorOwner()) return contributorDeleteLink(receiptId, txnId);
  const { error } = await db().from('receipt_links').delete().eq('user_id', meId()).eq('receipt_id', receiptId).eq('txn_id', txnId);
  if (error) throw new Error(`Could not remove the link: ${error.message}`);
}

/** Say there is no link to expect (paid in cash, no receipt for rent...). Replaces an earlier flag on the same receipt or charge. */
export async function setFlag(kind: 'receipt' | 'txn', refId: string, reason: NoLinkReason, note?: string, owner?: string): Promise<void> {
  if (contributorOwner()) return contributorSetFlag(kind, refId, reason, note);
  const { error } = await db().from('link_flags').upsert({ ...(owner ? { user_id: owner } : {}), kind, ref_id: refId, reason, note: note ?? null }, { onConflict: 'user_id,kind,ref_id' });
  if (error) throw new Error(`Could not save that: ${error.message}`);
}

export async function clearFlag(kind: 'receipt' | 'txn', refId: string): Promise<void> {
  if (contributorOwner()) return contributorClearFlag(kind, refId);
  const { error } = await db().from('link_flags').delete().eq('user_id', meId()).eq('kind', kind).eq('ref_id', refId);
  if (error) throw new Error(`Could not clear that: ${error.message}`);
}
