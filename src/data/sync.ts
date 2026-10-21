import { parseOverlay, rowToAccount, rowToTxn } from '@/core/sync';
import type { AccountRow, TxnRow } from '@/core/sync';
import type { Account, Overlay, Txn } from '@/core/types';
import { meId } from './scope';
import { supabase } from './supabase';

const db = () => { if (!supabase) throw new Error('backend not configured'); return supabase; };
const PAGE = 1000;

/** All of one person's rows in a table (the signed-in person's, unless `owner` says otherwise). */
export async function all<T>(table: string, order: string, owner: string = meId()): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select('*').eq('user_id', owner).order(order).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Statement-derived rows from the database, or null when the person has none yet. */
export async function fetchLedger(owner: string = meId()): Promise<{ accounts: Account[]; txns: Txn[] } | null> {
  // an account that was merged into another is hidden; its transactions already belong to the account it went into
  const accounts = (await all<AccountRow & { merged_into?: string | null }>('accounts', 'id', owner)).filter((a) => !a.merged_into);
  if (!accounts.length) return null;
  const txns = await all<TxnRow>('txns', 'id', owner);
  return { accounts: accounts.map(rowToAccount), txns: txns.map(rowToTxn) };
}

export async function fetchOverlay(owner: string = meId()): Promise<Overlay | null> {
  const { data, error } = await db().from('overlays').select('body').eq('user_id', owner).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? parseOverlay(data.body) : null;
}

export async function pushOverlay(overlay: Overlay): Promise<void> {
  const { error } = await db().from('overlays').upsert({ user_id: meId(), body: overlay, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}
