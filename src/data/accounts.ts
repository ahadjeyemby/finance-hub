import { mergedNumbers, unmergedNumbers, whyNotMerge } from '@/core/accounts';
import type { Account, AccountNumber } from '@/core/types';
import { rowToAccount } from '@/core/sync';
import type { AccountRow } from '@/core/sync';
import { signed } from './evidence';
import { dbAccount, meId } from './scope';
import { supabase } from './supabase';

/** Store the extra numbers of one account (the main number stays on the account itself). Needs migration 0004. */
export async function saveAccountNumbers(account: Pick<Account, 'id' | 'owner'>, numbers: AccountNumber[]): Promise<void> {
  if (!supabase) throw new Error('No database is connected.');
  const at = dbAccount(account);
  const { error } = await supabase.from('accounts').update({ extra_numbers: numbers }).eq('user_id', at.owner).eq('id', at.id);
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
export async function fetchStatements(account: Pick<Account, 'id' | 'owner'> | null): Promise<StatementRef[]> {
  if (!supabase) return [];
  const at = account ? dbAccount(account) : null;
  const base = supabase.from('statements').select('id, label, period_from, period_to, opening_balance_cents, closing_balance_cents, reconciled, reconciliation, source_file, pages, storage_path');
  const { data, error } = await (at === null ? base.eq('user_id', meId()).is('account_id', null) : base.eq('user_id', at.owner).eq('account_id', at.id)).order('period_from', { ascending: false });
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

const needsMergeMigration = (m: string) => /merge_accounts|unmerge_accounts|merged_into|merged_from|schema cache/i.test(m);

/** Merge `source` into `target`: its transactions and statements move to `target`, its numbers are added to it, and it is hidden. One database transaction; nothing is deleted. */
export async function mergeAccounts(source: Account, target: Account): Promise<{ transactions: number; statements: number }> {
  if (!supabase) throw new Error('No database is connected.');
  const why = whyNotMerge(source, target);
  if (why) throw new Error(why);
  const { data, error } = await supabase.rpc('merge_accounts', { p_source: source.id, p_target: target.id, p_numbers: mergedNumbers(target, source) });
  if (error) throw new Error(needsMergeMigration(error.message) ? 'The database needs migration 0005 first (supabase db push).' : error.message);
  return data as { transactions: number; statements: number };
}

/** Undo a merge: everything that moved goes back, and the account is shown again. */
export async function unmergeAccount(source: Account, target: Account): Promise<{ transactions: number; statements: number }> {
  if (!supabase) throw new Error('No database is connected.');
  const { data, error } = await supabase.rpc('unmerge_accounts', { p_source: source.id, p_numbers: unmergedNumbers(target, source) });
  if (error) throw new Error(needsMergeMigration(error.message) ? 'The database needs migration 0005 first (supabase db push).' : error.message);
  return data as { transactions: number; statements: number };
}

/** Accounts that were merged away, with the account each went into. Empty when nothing was merged or migration 0005 is not run. */
export async function fetchMergedAccounts(): Promise<(Account & { mergedInto: string })[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('accounts').select('*').eq('user_id', meId()).not('merged_into', 'is', null);
  if (error) return [];
  return (data ?? []).map((r) => ({ ...rowToAccount(r as AccountRow), mergedInto: r.merged_into as string }));
}
