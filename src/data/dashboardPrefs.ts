import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isWidgetId } from '@/dashboard/catalog';
import type { PrefRow } from '@/dashboard/layout';
import { isViewId } from '@/dashboard/views';
import type { ViewId } from '@/dashboard/views';
import { useRepo } from './repo';
import { supabase } from './supabase';

// The person's widget choices per view (table dashboard_widget_prefs, migration 0008). A copy is kept on the device so the dashboard opens with
// the right widgets before the database answers, and works without a backend. Writes go out one at a time in the order they were made, each
// carrying the view's whole snapshot, so quick switching can never leave an older choice on the server.

export type Prefs = Partial<Record<ViewId, PrefRow[]>>;

interface DbRow { view: string; widget_id: string; enabled: boolean; position: number }

export const rowsToPrefs = (rows: DbRow[]): Prefs => {
  const out: Prefs = {};
  for (const r of rows) {
    if (!isViewId(r.view) || !isWidgetId(r.widget_id)) continue;
    (out[r.view] ??= []).push({ widget: r.widget_id, enabled: r.enabled, position: r.position });
  }
  return out;
};

async function fetchPrefs(userId: string): Promise<Prefs> {
  if (!supabase) return {};
  const { data, error } = await supabase.from('dashboard_widget_prefs').select('view, widget_id, enabled, position').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return rowsToPrefs((data ?? []) as DbRow[]);
}

async function pushView(userId: string, view: ViewId, rows: PrefRow[] | null): Promise<void> {
  if (!supabase) return;
  if (!rows) {
    const { error } = await supabase.from('dashboard_widget_prefs').delete().eq('user_id', userId).eq('view', view);
    if (error) throw new Error(error.message);
    return;
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from('dashboard_widget_prefs').upsert(
    rows.map((r) => ({ user_id: userId, view, widget_id: r.widget, enabled: r.enabled, position: r.position, updated_at: now })),
    { onConflict: 'user_id,view,widget_id' },
  );
  if (error) throw new Error(error.message);
}

export interface WidgetPrefsApi {
  prefs: Prefs;
  /** save a view's whole snapshot */
  save: (view: ViewId, rows: PrefRow[]) => void;
  /** go back to the preset: the view's rows are deleted */
  reset: (view: ViewId) => void;
  /** the last save that failed, in words; cleared by the next one that works */
  error: string | null;
}

export function useWidgetPrefs(): WidgetPrefsApi {
  const { auth } = useRepo();
  const userId = auth.userId;
  const cacheKey = `finora.dashprefs.v1.${userId ?? 'local'}`;
  // the choices are held with the key they belong to, so after a sign-in change the previous person's choices are never shown
  const [store, setStore] = useState<{ key: string; prefs: Prefs }>({ key: '', prefs: {} });
  const [error, setError] = useState<string | null>(null);
  const storeRef = useRef(store);
  const edited = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    edited.current = false;
    const put = (prefs: Prefs) => { storeRef.current = { key: cacheKey, prefs }; setStore(storeRef.current); };
    (async () => {
      try { const raw = await AsyncStorage.getItem(cacheKey); if (live && !edited.current) put(raw ? (JSON.parse(raw) as Prefs) : {}); } catch { /* no saved copy */ }
      if (!userId || !supabase) return;
      try {
        const remote = await fetchPrefs(userId);
        // a switch made while the database was answering wins over what it sent
        if (!live || edited.current) return;
        put(remote);
        AsyncStorage.setItem(cacheKey, JSON.stringify(remote)).catch(() => {});
      } catch { /* keep the saved copy; the table may not exist yet (migration 0008) */ }
    })();
    return () => { live = false; };
  }, [cacheKey, userId]);

  const apply = useCallback((view: ViewId, rows: PrefRow[] | null) => {
    edited.current = true;
    const next: Prefs = { ...(storeRef.current.key === cacheKey ? storeRef.current.prefs : {}) };
    if (rows) next[view] = rows; else delete next[view];
    storeRef.current = { key: cacheKey, prefs: next }; setStore(storeRef.current);
    AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
    if (!userId || !supabase) return;
    queue.current = queue.current.then(() => pushView(userId, view, rows)).then(() => setError(null), (e: Error) => setError(e.message));
  }, [cacheKey, userId]);

  return { prefs: store.key === cacheKey ? store.prefs : {}, save: (view, rows) => apply(view, rows), reset: (view) => apply(view, null), error };
}
