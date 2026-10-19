import type { AccountNumber } from '@/core/types';
import { supabase } from './supabase';

/** Store the extra numbers of one account (the main number stays on the account itself). Needs migration 0004. */
export async function saveAccountNumbers(accountId: string, numbers: AccountNumber[]): Promise<void> {
  if (!supabase) throw new Error('No database is connected.');
  const { error } = await supabase.from('accounts').update({ extra_numbers: numbers }).eq('id', accountId);
  if (error) throw new Error(/extra_numbers|schema cache/i.test(error.message) ? 'The database needs migration 0004 first (supabase db push).' : `Could not save the number: ${error.message}`);
}
