import type { AccountNumber } from '@/core/types';
import { signed } from './evidence';
import { supabase } from './supabase';

/** Store the extra numbers of one account (the main number stays on the account itself). Needs migration 0004. */
export async function saveAccountNumbers(accountId: string, numbers: AccountNumber[]): Promise<void> {
  if (!supabase) throw new Error('No database is connected.');
  const { error } = await supabase.from('accounts').update({ extra_numbers: numbers }).eq('id', accountId);
  if (error) throw new Error(/extra_numbers|schema cache/i.test(error.message) ? 'The database needs migration 0004 first (supabase db push).' : `Could not save the number: ${error.message}`);
}

/** One statement document, as listed under an account. */
export interface StatementRef {
  id: string; label: string | null; periodFrom: string | null; periodTo: string | null;
  openingCents: number | null; closingCents: number | null;
  /** did the rows add up to the printed balances when it was saved; null when that was not recorded */
  reconciled: boolean | null;
  /** transactions the statement contributed, when recorded */
  rows: number | null;
  sourceFile: string | null; pages: number | null; storagePath: string | null;
}

/** The statements saved for an account (newest first), or those kept without an account (null). */
export async function fetchStatements(accountId: string | null): Promise<StatementRef[]> {
  if (!supabase) return [];
  const base = supabase.from('statements').select('id, label, period_from, period_to, opening_balance_cents, closing_balance_cents, reconciled, reconciliation, source_file, pages, storage_path');
  const { data, error } = await (accountId === null ? base.is('account_id', null) : base.eq('account_id', accountId)).order('period_from', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string, label: r.label as string | null, periodFrom: r.period_from as string | null, periodTo: r.period_to as string | null,
    openingCents: r.opening_balance_cents as number | null, closingCents: r.closing_balance_cents as number | null, reconciled: r.reconciled as boolean | null,
    rows: typeof (r.reconciliation as { rows?: number } | null)?.rows === 'number' ? (r.reconciliation as { rows: number }).rows : null,
    sourceFile: r.source_file as string | null, pages: r.pages as number | null, storagePath: r.storage_path as string | null,
  }));
}

/** A link to the original PDF or photo that opens for a few minutes. null when no original was stored. */
export const statementFileUrl = (path: string | null) => signed('statements', path);
