import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isWidgetId } from '@/dashboard/catalog';
import { mergePrefs } from '@/dashboard/layout';
import type { PrefRow, Prefs } from '@/dashboard/layout';
import { isViewId } from '@/dashboard/views';
import type { ViewId } from '@/dashboard/views';
import { useRepo } from './repo';
import { supabase } from './supabase';

// The person's widget choices per view (table dashboard_widget_prefs, migration 0008). A copy is kept on the device so the dashboard opens with
// the right widgets before the database answers, and works without a backend. Writes go out one at a time in the order they were made, each
// carrying the view's whole snapshot, so quick switching can never leave an older choice on the server.

export type { Prefs };

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
  /** a save or a load that failed, in words; cleared once everything is saved */
  error: string | null;
}

/** What the device keeps: the choices, and the views changed here that the database has not confirmed yet. */
interface Cache { prefs: Prefs; unsaved: ViewId[] }
const readCache = (raw: string | null): Cache => {
  if (!raw) return { prefs: {}, unsaved: [] };
  const v = JSON.parse(raw) as Partial<Cache> & Prefs;
  // the first version stored the choices alone
  return v.prefs && typeof v.prefs === 'object' ? { prefs: v.prefs, unsaved: (v.unsaved ?? []).filter(isViewId) } : { prefs: v as Prefs, unsaved: [] };
};

export function useWidgetPrefs(): WidgetPrefsApi {
  const { auth } = useRepo();
  const userId = auth.userId;
  const cacheKey = `finora.dashprefs.v1.${userId ?? 'local'}`;
  // the choices are held with the key they belong to, so after a sign-in change the previous person's choices are never shown
  const [store, setStore] = useState<{ key: string; prefs: Prefs }>({ key: '', prefs: {} });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const storeRef = useRef(store);
  const unsaved = useRef(new Set<ViewId>());
  const queue = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback((prefs: Prefs) => {
    storeRef.current = { key: cacheKey, prefs }; setStore(storeRef.current);
    AsyncStorage.setItem(cacheKey, JSON.stringify({ prefs, unsaved: [...unsaved.current] } satisfies Cache)).catch(() => {});
  }, [cacheKey]);

  /** send every view not yet confirmed, one at a time; a failure leaves it (and the rest) for the next attempt */
  const flush = useCallback(() => {
    if (!userId || !supabase) return;
    queue.current = queue.current.then(async () => {
      try {
        for (const v of [...unsaved.current]) {
          await pushView(userId, v, storeRef.current.prefs[v] ?? null);
          unsaved.current.delete(v);
        }
        setSaveError(null);
      } catch (e) { setSaveError((e as Error).message); }
      persist(storeRef.current.prefs);
    });
  }, [userId, persist]);

  useEffect(() => {
    let live = true;
    unsaved.current = new Set();
    (async () => {
      let local: Cache = { prefs: {}, unsaved: [] };
      try { local = readCache(await AsyncStorage.getItem(cacheKey)); } catch { /* no saved copy */ }
      if (!live) return;
      for (const v of local.unsaved) unsaved.current.add(v);
      // anything switched on this device while the copy was being read stays as switched
      const mine = storeRef.current.key === cacheKey ? storeRef.current.prefs : {};
      persist(mergePrefs(local.prefs, mine, storeRef.current.key === cacheKey ? unsaved.current : []));
      if (!userId || !supabase) return;
      try {
        const remote = await fetchPrefs(userId);
        if (!live) return;
        setLoadError(null);
        persist(mergePrefs(remote, storeRef.current.prefs, unsaved.current));
        if (unsaved.current.size) flush();
      } catch (e) {
        // the table may not exist yet (migration 0008), or the network is down: say so, and keep using this device's copy
        if (live) setLoadError((e as Error).message);
      }
    })();
    return () => { live = false; };
  }, [cacheKey, userId, persist, flush]);

  const apply = useCallback((view: ViewId, rows: PrefRow[] | null) => {
    const next: Prefs = { ...(storeRef.current.key === cacheKey ? storeRef.current.prefs : {}) };
    if (rows) next[view] = rows; else delete next[view];
    unsaved.current.add(view);
    persist(next);
    flush();
  }, [cacheKey, persist, flush]);

  return {
    prefs: store.key === cacheKey ? store.prefs : {},
    save: (view, rows) => apply(view, rows),
    reset: (view) => apply(view, null),
    error: saveError ?? (loadError ? `Your saved widget choices could not be loaded (${loadError}).` : null),
  };
}
