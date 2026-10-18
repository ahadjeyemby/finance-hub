import type { SupabaseClient } from '@supabase/supabase-js';

import { findSameReceipt, keyOf } from './dedupe';
import type { ReceiptKey } from './dedupe';
import { matchReceipt, rawToRow, receiptToLines, receiptToRow, statementToRow } from './evidence';
import type { RawRecord, ReceiptRecord, StatementRecord } from './evidence';
import { accountToRow, chunk, txnToRow } from './sync';
import type { Account, Txn } from './types';

// Reading a ledger file and loading it into Supabase. Used by scripts/upload-ledger.ts, never bundled into the app.

export interface LedgerFile { accounts: Account[]; txns: Txn[] }

/** Structural check of a ledger file before anything is sent. Returns the problems found (empty = safe to upload). */
export function checkLedgerFile(data: unknown): { ledger: LedgerFile | null; problems: string[] } {
  const problems: string[] = [];
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!Array.isArray(d.accounts) || !Array.isArray(d.txns)) return { ledger: null, problems: ['file must be {"accounts": [...], "txns": [...]}'] };
  const accounts = d.accounts as Account[];
  const txns = d.txns as Txn[];
  const accountIds = new Set<string>();
  for (const a of accounts) {
    if (!a?.id || typeof a.id !== 'string') problems.push('an account has no id');
    else if (accountIds.has(a.id)) problems.push(`duplicate account id ${a.id}`);
    else accountIds.add(a.id);
    if (!a?.coverage?.from || !a?.coverage?.to) problems.push(`account ${a?.id} has no coverage dates`);
  }
  const txnIds = new Set<string>();
  for (const t of txns) {
    if (!t?.id || typeof t.id !== 'string') { problems.push('a transaction has no id'); continue; }
    if (txnIds.has(t.id)) problems.push(`duplicate transaction id ${t.id}`);
    txnIds.add(t.id);
    if (!accountIds.has(t.accountId)) problems.push(`transaction ${t.id} points at unknown account ${t.accountId}`);
    if (!Number.isInteger(t.cents)) problems.push(`transaction ${t.id} has non-integer cents`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? '')) problems.push(`transaction ${t.id} has a bad date`);
    if (problems.length > 20) { problems.push('...and more'); break; }
  }
  return { ledger: problems.length ? null : { accounts, txns }, problems };
}

/** Statement rows only. Cash entries typed in the app live in the overlay, not here. */
export const statementTxns = (txns: Txn[]): Txn[] => txns.filter((t) => !t.manual);

/** Upsert by (user, id): safe to run again. Accounts first, because transactions reference them. */
export async function uploadLedger(db: SupabaseClient, ledger: LedgerFile, size = 400): Promise<{ accounts: number; txns: number }> {
  const a = await db.from('accounts').upsert(ledger.accounts.map(accountToRow), { onConflict: 'user_id,id' });
  if (a.error) throw a.error;
  const rows = statementTxns(ledger.txns).map(txnToRow);
  for (const part of chunk(rows, size)) {
    const r = await db.from('txns').upsert(part, { onConflict: 'user_id,id' });
    if (r.error) throw r.error;
  }
  return { accounts: ledger.accounts.length, txns: rows.length };
}

/** Delete this user's statement rows (row level security limits it to them). Transactions first, then accounts. */
export async function wipeLedger(db: SupabaseClient): Promise<void> {
  const t = await db.from('txns').delete().not('id', 'is', null);   // txn_raw rows go with them (on delete cascade)
  if (t.error) throw t.error;
  // statements point at accounts without a cascade, so they must go first or the accounts delete is refused
  const s = await db.from('statements').delete().not('id', 'is', null);
  if (s.error) throw s.error;
  const a = await db.from('accounts').delete().not('id', 'is', null);
  if (a.error) throw a.error;
}

// ---- evidence: statements, raw lines, receipts, original files ----

export interface EvidenceBundle { statements?: StatementRecord[]; raw?: RawRecord[]; receipts?: ReceiptRecord[] }
export interface EvidenceOptions {
  userId: string;
  /** returns the bytes of a source file (path relative to the documents folder), or null when it is not there */
  readFile?: (relPath: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
  log?: (line: string) => void;
}
export interface EvidenceResult { statements: number; raw: number; receipts: number; files: number; linked: number; unlinked: { source: string; reason: string; candidates: string[] }[]; extraDocuments: { source: string; of: string; why: string }[] }

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

async function putFile(db: SupabaseClient, bucket: 'statements' | 'receipts', o: EvidenceOptions, rel: string | undefined, sha: string | undefined): Promise<string | null> {
  if (!rel || !o.readFile) return null;
  const f = await o.readFile(rel);
  if (!f) { o.log?.(`  file not found, skipped: ${rel}`); return null; }
  const base = rel.split('/').pop()!;
  const path = `${o.userId}/${(sha ?? '').slice(0, 12)}${sha ? '-' : ''}${safe(base)}`;
  const r = await db.storage.from(bucket).upload(path, f.bytes, { contentType: f.contentType, upsert: true });
  if (r.error) throw r.error;
  return path;
}

/** Idempotent: rerunning updates rows in place. Needs the ledger already uploaded (foreign keys). */
export async function uploadEvidence(db: SupabaseClient, ledger: LedgerFile, bundle: EvidenceBundle, o: EvidenceOptions): Promise<EvidenceResult> {
  const res: EvidenceResult = { statements: 0, raw: 0, receipts: 0, files: 0, linked: 0, unlinked: [], extraDocuments: [] };

  for (const s of bundle.statements ?? []) {
    const path = await putFile(db, 'statements', o, s.sourceFile, s.sha256);
    if (path) res.files++;
    const r = await db.from('statements').upsert(statementToRow(s, path), { onConflict: 'user_id,id' });
    if (r.error) throw r.error;
    res.statements++;
  }

  const known = new Set(ledger.txns.map((t) => t.id));
  const raw = (bundle.raw ?? []).filter((r) => known.has(r.txnId)).map(rawToRow);
  for (const part of chunk(raw, 300)) {
    const r = await db.from('txn_raw').upsert(part, { onConflict: 'user_id,txn_id' });
    if (r.error) throw r.error;
  }
  res.raw = raw.length;

  const patches: Record<string, { lines?: { item: string; cents: number }[]; receiptId: string }> = {};
  const seenKeys: ReceiptKey[] = [];
  for (const rec of bundle.receipts ?? []) {
    const m = rec.txnId ? { txnId: rec.txnId, candidates: [rec.txnId], reason: 'given' } : matchReceipt(rec, ledger.txns);
    const path = await putFile(db, 'receipts', o, rec.sourceFile, rec.sha256);
    if (path) res.files++;
    // a second document for a purchase already stored (paper photo + e-receipt) is marked as such; both stay as evidence
    const same = findSameReceipt(rec, seenKeys);
    if (same) res.extraDocuments.push({ source: rec.sourceFile ?? rec.merchant ?? 'receipt', of: same.of.label, why: same.why });
    const row = receiptToRow(same ? { ...rec, duplicateOf: same.of.id } : rec, path, m.txnId);
    const q = rec.sha256
      ? await db.from('receipts').upsert(row, { onConflict: 'user_id,sha256' }).select('id').single()
      : await db.from('receipts').insert(row).select('id').single();
    if (q.error) throw q.error;
    res.receipts++;
    seenKeys.push(keyOf(rec, q.data.id as string, rec.sourceFile ?? rec.merchant ?? 'receipt', m.txnId));
    if (m.txnId) {
      res.linked++;
      const t = ledger.txns.find((x) => x.id === m.txnId)!;
      const lines = receiptToLines(rec, -t.cents);
      // two documents for one charge (paper photo + e-receipt): both rows link to it, the first one fills the item lines
      patches[m.txnId] ??= { receiptId: q.data.id as string, ...(lines.length ? { lines } : {}) };
    } else res.unlinked.push({ source: rec.sourceFile ?? rec.merchant ?? 'receipt', reason: m.reason, candidates: m.candidates });
  }

  // Link receipts to their transactions inside the app's overlay (additive: existing answers are kept).
  if (Object.keys(patches).length) {
    const cur = await db.from('overlays').select('body').maybeSingle();
    if (cur.error) throw cur.error;
    const body = (cur.data?.body ?? {}) as { patches?: Record<string, object> };
    const merged = { ...(cur.data?.body ?? {}), patches: { ...(body.patches ?? {}) } } as { patches: Record<string, object> };
    for (const [id, p] of Object.entries(patches)) merged.patches[id] = { ...(merged.patches[id] ?? {}), ...p };
    const w = await db.from('overlays').upsert({ body: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (w.error) throw w.error;
  }
  return res;
}
