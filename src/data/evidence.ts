import { rowToReceipt, rowToStatement } from '@/core/evidence';
import type { ReceiptView, StatementView } from '@/core/evidence';
import type { Txn } from '@/core/types';
import { supabase } from './supabase';

export interface RawLine { statementId: string | null; lineNo: number | null; postedDate: string | null; sourceFile: string | null; row: Record<string, unknown> }
export interface Evidence {
  /** false when the database could not be reached: only what is on this device is shown */
  online: boolean;
  raw: RawLine | null;
  statement: (StatementView & { url: string | null }) | null;
  receipts: (ReceiptView & { url: string | null })[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signed(bucket: 'statements' | 'receipts', path: string | null): Promise<string | null> {
  if (!supabase || !path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/** Everything stored about where a transaction came from. Read on demand, so the ledger sync stays small. */
export async function fetchEvidence(t: Txn): Promise<Evidence> {
  const empty: Evidence = { online: false, raw: null, statement: null, receipts: [] };
  if (!supabase) return empty;
  try {
    let raw: RawLine | null = null;
    let statement: Evidence['statement'] = null;
    if (!t.manual) {
      const r = await supabase.from('txn_raw').select('statement_id,line_no,posted_date,source_file,row').eq('txn_id', t.id).maybeSingle();
      if (r.error) throw r.error;
      if (r.data) {
        raw = { statementId: r.data.statement_id, lineNo: r.data.line_no, postedDate: r.data.posted_date, sourceFile: r.data.source_file, row: r.data.row as Record<string, unknown> };
        if (raw.statementId) {
          const s = await supabase.from('statements').select('*').eq('id', raw.statementId).maybeSingle();
          if (s.error) throw s.error;
          if (s.data) { const v = rowToStatement(s.data); statement = { ...v, url: await signed('statements', v.storagePath) }; }
        }
      }
    }
    const byTxn = await supabase.from('receipts').select('*').eq('txn_id', t.id);
    if (byTxn.error) throw byTxn.error;
    const rows = [...(byTxn.data ?? [])];
    if (t.receiptId && UUID.test(t.receiptId) && !rows.some((x) => x.id === t.receiptId)) {
      const byId = await supabase.from('receipts').select('*').eq('id', t.receiptId).maybeSingle();
      if (byId.error) throw byId.error;
      if (byId.data) rows.push(byId.data);
    }
    const receipts = await Promise.all(rows.map(async (x) => { const v = rowToReceipt(x); return { ...v, url: await signed('receipts', v.storagePath) }; }));
    return { online: true, raw, statement, receipts };
  } catch {
    return empty;
  }
}
