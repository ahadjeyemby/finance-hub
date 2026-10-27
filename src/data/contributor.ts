// The calls a Contributor makes (migration 0009), and the owner's side of them. A Contributor never reads or writes a data table: everything
// goes through the contributor functions, which decide in the database what may come back. This file only moves rows; the rules the app
// keeps are in core/contributor.ts.
import type { CategoryConfig } from '@/core/categories';
import { diffEdits, editsFromOverlay } from '@/core/contributor';
import type { ContributorEdit, StoredEdit } from '@/core/contributor';
import { rowToRecord } from '@/core/evidence';
import type { Link, LinkFlag } from '@/core/links';
import { rowToAccount, rowToTxn } from '@/core/sync';
import type { AccountRow, TxnRow } from '@/core/sync';
import type { TagState } from '@/core/tags';
import type { Account, Overlay, StatementPeriod, Txn } from '@/core/types';
import type { LinkData } from './links';
import { contributorOwner, meId } from './scope';
import { supabase } from './supabase';

const db = () => { if (!supabase) throw new Error('No database is connected.'); return supabase; };
const fail = (e: { message: string } | null, what: string) => { if (e) throw new Error(`${what}: ${e.message}`); };

/** Everything a Contributor's app shows, in one call. */
export interface ContributorSnapshot {
  owner: string;
  accounts: Account[];
  txns: Txn[];
  /** which periods of each card are already in, with the statement's id: no balances */
  statements: { id: string; accountId: string; from: string; to: string }[];
  links: LinkData;
  categories: CategoryConfig | undefined;
  tags: TagState;
}

export async function fetchContributorSnapshot(): Promise<ContributorSnapshot> {
  const r = await db().rpc('contributor_spending');
  fail(r.error, 'Could not load the spending');
  const s = r.data as Record<string, any>;
  return {
    owner: s.owner,
    accounts: (s.accounts as AccountRow[]).map((a) => rowToAccount({ ...a, income_complete: null })),
    txns: (s.txns as TxnRow[]).map(rowToTxn),
    statements: (s.statements as Record<string, string>[]).filter((x) => x.period_from && x.period_to).map((x) => ({ id: x.id, accountId: x.account_id, from: x.period_from, to: x.period_to })),
    links: {
      links: (s.links as Record<string, any>[]).map((l): Link => ({ id: l.id, receiptId: l.receipt_id, txnId: l.txn_id, amountCents: l.amount_cents, role: l.role, method: l.method, reason: l.reason, confirmed: !!l.confirmed })),
      flags: (s.flags as Record<string, any>[]).map((f): LinkFlag => ({ kind: f.kind, refId: f.ref_id, reason: f.reason, note: f.note })),
      receipts: (s.receipts as Record<string, any>[]).map(rowToRecord),
    },
    categories: s.categories ?? undefined,
    tags: { defs: s.tags?.defs ?? [], edits: s.tags?.edits ?? {} },
  };
}

export const periodsOf = (s: ContributorSnapshot): StatementPeriod[] => s.statements.map((x) => ({ accountId: x.accountId, from: x.from, to: x.to }));

/** A Contributor's decisions, sent as their rows in contributor_edits: what changed is written, what was taken back is removed. */
export async function pushContributorEdits(overlay: Overlay): Promise<void> {
  const owner = contributorOwner();
  if (!owner) return;
  const me = meId();
  const cur = await db().from('contributor_edits').select('key, patch').eq('owner', owner).eq('contributor', me);
  fail(cur.error, 'Could not read your changes');
  const { upsert, remove } = diffEdits(editsFromOverlay(overlay), (cur.data ?? []) as ContributorEdit[]);
  if (upsert.length) {
    const all = await db().from('contributor_edits').upsert(upsert.map((e) => ({ owner, contributor: me, key: e.key, patch: e.patch })), { onConflict: 'owner,contributor,key' });
    // one change the database refuses (a charge that has since gone) must not hold back the others
    if (all.error) for (const e of upsert) await db().from('contributor_edits').upsert({ owner, contributor: me, key: e.key, patch: e.patch }, { onConflict: 'owner,contributor,key' });
  }
  if (remove.length) {
    const d = await db().from('contributor_edits').delete().eq('owner', owner).eq('contributor', me).in('key', remove);
    fail(d.error, 'Could not remove a change');
  }
}

/** The owner's side: what every Contributor in the workspace changed. Empty before migration 0009. */
export async function fetchEditsForOwner(): Promise<StoredEdit[]> {
  if (!supabase) return [];
  const r = await supabase.from('contributor_edits').select('contributor, key, patch, updated_at').eq('owner', meId());
  if (r.error) return [];
  return (r.data ?? []).map((e) => ({ contributor: e.contributor as string, key: e.key as string, patch: e.patch as Record<string, unknown>, updatedAt: e.updated_at as string }));
}

/** The owner's side: pair card payments a Contributor added with the payment out of checking. */
export async function savePairs(pairs: { id: string; pairId: string }[]): Promise<void> {
  for (const p of pairs) {
    const r = await db().from('txns').update({ pair_id: p.pairId }).eq('user_id', meId()).eq('id', p.id);
    fail(r.error, 'Could not link a card payment');
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Documents, links and flags, for a Contributor. The general data calls (intake.ts, links.ts) send a Contributor here.
// ---------------------------------------------------------------------------------------------------------------------------------------------
export async function contributorFileSeen(kind: 'receipt' | 'statement', sha256: string): Promise<boolean> {
  const r = await db().rpc('contributor_file_seen', { p_kind: kind, p_sha256: sha256 });
  fail(r.error, 'Could not check the file');
  return !!r.data;
}

export async function contributorSaveReceipt(row: Record<string, unknown>): Promise<string> {
  const r = await db().rpc('contributor_save_receipt', { p_row: row });
  fail(r.error, 'Could not save the receipt');
  return r.data as string;
}

export async function contributorUpdateReceipt(id: string, row: Record<string, unknown>): Promise<void> {
  fail((await db().rpc('contributor_update_receipt', { p_id: id, p_row: row })).error, 'Could not save the receipt');
}

/** The full stored reading of one receipt, which a correction keeps everything else of. */
export async function contributorReceiptRaw(id: string): Promise<Record<string, unknown>> {
  const r = await db().rpc('contributor_spending');
  fail(r.error, 'Could not read the receipt');
  const rec = ((r.data as Record<string, any>).receipts as Record<string, any>[]).find((x) => x.id === id);
  if (!rec) throw new Error('That receipt is no longer stored.');
  return (rec.raw ?? {}) as Record<string, unknown>;
}

export async function contributorSaveLinks(rows: Record<string, unknown>[]): Promise<void> {
  fail((await db().rpc('contributor_save_links', { p_links: rows })).error, 'Could not save the link');
}
export async function contributorDeleteLink(receiptId: string, txnId: string): Promise<void> {
  fail((await db().rpc('contributor_delete_link', { p_receipt: receiptId, p_txn: txnId })).error, 'Could not remove the link');
}
export async function contributorSetFlag(kind: 'receipt' | 'txn', refId: string, reason: string, note?: string): Promise<void> {
  fail((await db().rpc('contributor_set_flag', { p_kind: kind, p_ref: refId, p_reason: reason, p_note: note ?? null })).error, 'Could not save that');
}
export async function contributorClearFlag(kind: 'receipt' | 'txn', refId: string): Promise<void> {
  fail((await db().rpc('contributor_clear_flag', { p_kind: kind, p_ref: refId })).error, 'Could not clear that');
}

export interface StatementSaved { statement: 'added' | 'already stored'; spendingAdded: number; spendingAlready: number }
export async function contributorSaveStatement(account: unknown, statement: unknown, txns: unknown[], raw: unknown[]): Promise<StatementSaved> {
  const r = await db().rpc('contributor_save_statement', { p_account: account, p_statement: statement, p_txns: txns, p_raw: raw });
  fail(r.error, 'Could not save the statement');
  const d = r.data as { statement: StatementSaved['statement']; spending_added: number; spending_already_stored: number };
  return { statement: d.statement, spendingAdded: d.spending_added, spendingAlready: d.spending_already_stored };
}
