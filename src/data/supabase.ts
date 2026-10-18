import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { projectRefOf } from '@/core/sync';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** the project this build talks to (the part before .supabase.co), or null when none is configured */
export const projectRef = projectRefOf(url);

/** null when no project is configured: the app then runs fully local. */
export const supabase = url && key
  ? createClient(url, key, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })
  : null;

/** Call an edge function as the signed-in user. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  if (!supabase || !url || !key) throw new Error('backend not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('signed out');
  const r = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: key }, body: JSON.stringify(body) });
  if (!r.ok) {
    // the functions answer { error: "..." } with a message meant for the person
    const detail = await r.json().then((j: { error?: unknown }) => (typeof j?.error === 'string' ? j.error : '')).catch(() => '');
    throw new Error(detail || `${name} answered ${r.status}`);
  }
  return r.json() as Promise<T>;
}
