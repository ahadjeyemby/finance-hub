import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { applyAnswer, cashToTxn, undoAnswer } from '@/core/answers';
import { addMonths, monthEnd, monthOf, monthStart, monthsBetween, todayISO } from '@/core/dates';
import { applyOverlay, runQuery } from '@/core/queries';
import type { Ctx, Filter } from '@/core/queries';
import { buildQuestions } from '@/core/questions';
import { emptyIncome } from '@/core/income';
import type { IncomeState } from '@/core/income';
import { emptyRecurring } from '@/core/recurring';
import type { RecurringState } from '@/core/recurring';
import type { CashDraft } from '@/core/questions';
import type { ReportSpec } from '@/core/report';
import { adoptUploadStamps, makeLedgerCache, mergeOverlays, overlayIsEmpty, ownerTag, ownerVerdict, parseLedgerCache, stampUploads } from '@/core/sync';
import type { LedgerKind } from '@/core/sync';
import { emptyOverlay } from '@/core/types';
import type { Account, CategoryId, Overlay, Question, Txn } from '@/core/types';
import { C, SERIES } from '@/theme/tokens';
import { fetchLedger, fetchOverlay, pushOverlay } from './sync';
import { fetchLinkData, NO_LINKS } from './links';
import type { LinkData } from './links';
import { applyLinks } from '@/core/links';
import { setCategoryConfig } from '@/core/categories';
import type { CategoryConfig } from '@/core/categories';
import { DEFAULT_TAGS, applyTags } from '@/core/tags';
import type { TagState } from '@/core/tags';
import { projectRef, supabase } from './supabase';

const KEY = 'audit.overlay.v1';
const LEDGER_KEY = 'audit.ledger.v1';
const DIRTY_KEY = 'audit.dirty.v1';
const SYNCED_KEY = 'audit.synced.v1';
const OWNER_KEY = 'audit.owner.v1';
export type Scope = 'all' | 'personal' | 'business';

interface Seed { accounts: Account[]; txns: Txn[] }
/** The app ships with no ledger. Statement data comes only from the person's own database. */
const EMPTY: Seed = { accounts: [], txns: [] };

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';
export interface AuthApi {
  /** false when no Supabase project is configured: the app runs fully local */
  configured: boolean;
  email: string | null;
  /** resolves to an error message, or null on success */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}
/** Where the numbers on screen came from. 'database' = Supabase answered this session. 'saved' = a copy downloaded earlier from this same project by this same person, shown because Supabase has not answered yet. */
export interface SourceInfo {
  kind: LedgerKind;
  /** Supabase project id, the part of the URL before .supabase.co */
  project: string | null;
  /** when the rows were downloaded */
  at: string | null;
  /** statement accounts and rows as Supabase returned them, before any local edit is applied */
  accounts: number;
  rows: number;
}
export interface SyncApi { state: SyncState; lastAt: string | null; error: string | null; now: () => Promise<void> }

export interface Repo {
  ready: boolean;
  /** true once the database has returned at least one account; the app shows "data is not available" until then */
  hasData: boolean;
  auth: AuthApi;
  sync: SyncApi;
  source: SourceInfo;
  accounts: Account[];
  txns: Txn[];
  ctx: Ctx;
  scope: Scope;
  setScope: (s: Scope) => void;
  /** adds the chosen scope to a filter */
  scoped: (f?: Filter) => Filter;
  overlay: Overlay;
  questions: Question[];
  /** last day any statement covers: the app treats this as "today" for forecasts and defaults */
  dataTo: string;
  dataFrom: string;
  /** earliest statement end across real accounts: months ending before this are complete */
  completeTo: string;
  months: string[];
  /** 'YYYY-MM' or 'all' */
  period: string;
  setPeriod: (p: string) => void;
  range: { from: string; to: string; label: string; complete: boolean };
  forecastMonth: string;
  answer: (q: Question, choice: string, toMerchant: boolean) => { goto?: 'add' };
  undo: (q: Question) => void;
  addCash: (d: CashDraft) => Txn;
  saveReport: (prompt: string, spec: ReportSpec) => string;
  deleteReport: (id: string) => void;
  patchTxn: (id: string, patch: Overlay['patches'][string]) => void;
  attachReceipt: (txnId: string, lines: { item: string; cents: number }[], uri: string) => void;
  /** the tag definitions and the person's changes to tags (always has the tag list, the default one until they change it) */
  tagState: TagState;
  /** change the tag definitions or the tags on a charge or an item */
  saveTagState: (next: TagState) => void;
  /** income sources, pay records and deposit assignments */
  income: IncomeState;
  saveIncome: (next: IncomeState) => void;
  /** what the person decided about recurring charges, and the ones added by hand */
  recurring: RecurringState;
  saveRecurring: (next: RecurringState) => void;
  /** the person's category changes: added, renamed, hidden and merged categories */
  categoryConfig: CategoryConfig | undefined;
  saveCategoryConfig: (next: CategoryConfig) => void;
  /** receipt-to-charge links, flags and stored receipts (null until loaded, or when migration 0003 has not been run) */
  links: LinkData | null;
  /** fetch the links again, after one was saved or changed */
  reloadLinks: () => Promise<void>;
  /** stable colour per category: top five by all-time spend get a series colour, the rest are grey */
  colorOf: (category: string) => string;
  reset: () => void;
}

const Ctx_ = createContext<Repo | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const configured = !!supabase;
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay());
  const [ledger, setLedger] = useState<Seed>(EMPTY);
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [ledgerFrom, setLedgerFrom] = useState<{ kind: LedgerKind; at: string | null }>({ kind: 'none', at: null });
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [scope, setScope] = useState<Scope>('all');
  const [syncInfo, setSyncInfo] = useState<{ state: SyncState; lastAt: string | null; error: string | null }>({ state: 'local', lastAt: null, error: null });

  const overlayRef = useRef(overlay);
  const dirtyRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = session?.user.id ?? null;
  userIdRef.current = userId;

  // local state first, so the app opens instantly and works offline
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) { const o = { ...emptyOverlay(), ...JSON.parse(raw) } as Overlay; overlayRef.current = o; setOverlay(o); }
        if (configured) {
          const dirty = await AsyncStorage.getItem(DIRTY_KEY);
          const synced = await AsyncStorage.getItem(SYNCED_KEY);
          // edits made before this device ever synced must not be overwritten by the server copy
          dirtyRef.current = !!dirty || (!synced && !overlayIsEmpty(overlayRef.current));
        }
      } catch { /* a corrupt or blocked store falls back to the empty overlay */ }
      setLoaded(true);
    })();
  }, [configured]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); }).catch(() => setAuthReady(true));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const store = (o: Overlay) => AsyncStorage.setItem(KEY, JSON.stringify(o)).catch(() => {});

  /** push, stamping manual entries with the time they reached the database; the stamps are only kept if the push succeeded */
  const pushStamped = useCallback(async (o: Overlay): Promise<Overlay> => {
    const stamped = stampUploads(o, new Date().toISOString());
    await pushOverlay(stamped);
    const adopted = adoptUploadStamps(overlayRef.current, stamped);
    if (adopted !== overlayRef.current) { overlayRef.current = adopted; setOverlay(adopted); store(adopted); }
    return stamped;
  }, []);

  const pushNow = useCallback(async () => {
    if (!supabase || !userIdRef.current) return;
    try {
      await pushStamped(overlayRef.current);
      dirtyRef.current = false;
      AsyncStorage.removeItem(DIRTY_KEY).catch(() => {});
      setSyncInfo({ state: 'synced', lastAt: new Date().toISOString(), error: null });
    } catch (e) { setSyncInfo((x) => ({ ...x, state: 'error', error: (e as Error).message })); }
  }, [pushStamped]);

  const commit = useCallback((next: Overlay) => {
    overlayRef.current = next;
    setOverlay(next);
    store(next);
    if (supabase && userIdRef.current) {
      dirtyRef.current = true;
      AsyncStorage.setItem(DIRTY_KEY, '1').catch(() => {});
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => { pushNow(); }, 1200);
    }
  }, [pushNow]);

  const syncNow = useCallback(async () => {
    if (!supabase || !userIdRef.current) return;
    setSyncInfo((x) => ({ ...x, state: 'syncing', error: null }));
    try {
      const remoteLedger = (await fetchLedger()) ?? EMPTY;
      const at = new Date().toISOString();
      setLedger(remoteLedger);
      setLedgerFrom({ kind: 'database', at });
      if (remoteLedger.accounts.length && projectRef && userIdRef.current) AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(makeLedgerCache(projectRef, userIdRef.current, at, remoteLedger))).catch(() => {});
      else AsyncStorage.removeItem(LEDGER_KEY).catch(() => {});

      setLinkData(await fetchLinkData());
      const remote = await fetchOverlay();
      const local = overlayRef.current;
      let next = remote ? (dirtyRef.current ? mergeOverlays(local, remote) : remote) : local;
      if (!remote || dirtyRef.current) next = await pushStamped(next);
      dirtyRef.current = false;
      AsyncStorage.removeItem(DIRTY_KEY).catch(() => {});
      AsyncStorage.setItem(SYNCED_KEY, '1').catch(() => {});
      if (next !== local) { overlayRef.current = next; setOverlay(next); store(next); }
      setSyncInfo({ state: 'synced', lastAt: new Date().toISOString(), error: null });
    } catch (e) { setSyncInfo((x) => ({ ...x, state: 'error', error: (e as Error).message })); }
  }, [pushStamped]);

  // sync when a session appears and whenever the app returns to the foreground
  // first check whose data is on this device, then show the saved copy (if it is this person's, from this project), then ask Supabase
  useEffect(() => {
    if (!userId || !loaded) return;
    let live = true;
    (async () => {
      try {
        const tag = ownerTag(projectRef, userId);
        const verdict = ownerVerdict(await AsyncStorage.getItem(OWNER_KEY), tag);
        if (verdict === 'other') {
          // another project or person was signed in here: none of its data or unsent edits may appear under this account
          if (pushTimer.current) clearTimeout(pushTimer.current);
          await AsyncStorage.multiRemove([KEY, LEDGER_KEY, DIRTY_KEY, SYNCED_KEY]).catch(() => {});
          dirtyRef.current = false; overlayRef.current = emptyOverlay();
          if (live) { setOverlay(emptyOverlay()); setLedger(EMPTY); setLinkData(null); setLedgerFrom({ kind: 'none', at: null }); }
        }
        await AsyncStorage.setItem(OWNER_KEY, tag).catch(() => {});
        const copy = parseLedgerCache(await AsyncStorage.getItem(LEDGER_KEY), projectRef, userId);
        if (copy && live) { setLedger((cur) => (cur.accounts.length ? cur : copy.ledger)); setLedgerFrom((cur) => (cur.kind === 'database' ? cur : { kind: 'saved', at: copy.at })); }
        else if (!copy) AsyncStorage.removeItem(LEDGER_KEY).catch(() => {});
      } catch { /* an unreadable store just means there is no saved copy */ }
      if (live) syncNow();
    })();
    return () => { live = false; };
  }, [userId, loaded, syncNow]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') syncNow(); });
    return () => sub.remove();
  }, [syncNow]);

  const auth = useMemo<AuthApi>(() => ({
    configured,
    email: session?.user.email ?? null,
    signIn: async (email, password) => {
      if (!supabase) return 'No backend is configured.';
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? error.message : null;
    },
    signOut: async () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      await supabase?.auth.signOut();
      await AsyncStorage.multiRemove([KEY, LEDGER_KEY, DIRTY_KEY, SYNCED_KEY, OWNER_KEY]).catch(() => {});
      dirtyRef.current = false; overlayRef.current = emptyOverlay();
      setOverlay(emptyOverlay()); setLedger(EMPTY); setLedgerFrom({ kind: 'none', at: null }); setSyncInfo({ state: 'local', lastAt: null, error: null });
    },
  }), [configured, session]);
  const sync = useMemo<SyncApi>(() => ({ ...syncInfo, state: configured ? syncInfo.state : 'local', now: syncNow }), [syncInfo, configured, syncNow]);
  const ready = loaded && authReady;
  const source = useMemo<SourceInfo>(() => ({ kind: ledgerFrom.kind, project: projectRef, at: ledgerFrom.at, accounts: ledger.accounts.length, rows: ledger.txns.length }), [ledgerFrom, ledger]);

  const receiptsById = useMemo(() => new Map((linkData ?? NO_LINKS).receipts.map((r) => [r.id, r])), [linkData]);
  const reloadLinks = useCallback(async () => { setLinkData(await fetchLinkData()); }, []);
  const tagState = useMemo<TagState>(() => ({ defs: overlay.tags?.defs?.length ? overlay.tags.defs : DEFAULT_TAGS, edits: overlay.tags?.edits ?? {} }), [overlay.tags]);
  // the category list is registered before anything is derived from it, so every screen below sees the person's own categories
  const txns = useMemo(() => {
    setCategoryConfig(overlay.categories);
    return applyTags(applyLinks(applyOverlay(ledger.txns, overlay), linkData?.links ?? [], receiptsById, linkData?.flags ?? []), tagState);
  }, [ledger, overlay, linkData, receiptsById, tagState]);
  const accounts = ledger.accounts;
  const ctx = useMemo<Ctx>(() => ({ txns, accounts }), [txns, accounts]);
  const questions = useMemo(() => buildQuestions(txns, overlay), [txns, overlay]);

  const hasData = accounts.length > 0;
  // with no accounts these fall back to today so the derived values below stay well-formed; the UI shows the empty state instead
  const dataTo = useMemo(() => accounts.filter((a) => a.type !== 'cash').reduce((m, a) => (a.coverage.to > m ? a.coverage.to : m), accounts.length ? '0000' : todayISO()), [accounts]);
  const dataFrom = useMemo(() => accounts.reduce((m, a) => (a.coverage.from < m ? a.coverage.from : m), accounts.length ? '9999' : todayISO()), [accounts]);

  const completeTo = useMemo(() => accounts.filter((a) => a.type !== 'cash').reduce((m, a) => (a.coverage.to < m ? a.coverage.to : m), '9999'), [accounts]);
  const lastDate = useMemo(() => txns.reduce((m, t) => (t.date > m ? t.date : m), dataTo), [txns, dataTo]);
  const months = useMemo(() => monthsBetween(monthOf(dataFrom), monthOf(lastDate)), [dataFrom, lastDate]);
  const defaultPeriod = useMemo(() => [...months].reverse().find((m) => monthEnd(m) <= completeTo) ?? months[months.length - 1], [months, completeTo]);
  const [periodState, setPeriod] = useState<string | null>(null);
  const period = periodState ?? defaultPeriod;
  const range = useMemo(() => period === 'all'
    ? { from: dataFrom, to: lastDate, label: 'All data', complete: false }
    : { from: monthStart(period), to: monthEnd(period), label: period, complete: monthEnd(period) <= completeTo }, [period, dataFrom, lastDate, completeTo]);

  const colors = useMemo(() => {
    const top = runQuery({ metric: 'spend', groupBy: 'category', sort: 'value_desc', limit: 5 }, ctx).rows.map((r) => r.key);
    return new Map(top.map((k, i) => [k, SERIES[i]]));
  }, [ctx]);

  const value = useMemo<Repo>(() => ({
    ready, hasData, auth, sync, source, accounts, txns, ctx, scope, setScope, overlay, questions, dataTo, dataFrom, completeTo, months, period, setPeriod, range,
    scoped: (f) => ({ ...(f ?? {}), scope }),
    forecastMonth: addMonths(monthOf(dataTo), 1),
    answer: (q, choice, toMerchant) => { const r = applyAnswer(q, choice, toMerchant, overlay); commit(r.overlay); return { goto: r.goto }; },
    undo: (q) => commit(undoAnswer(q, overlay)),
    // mutators read the live overlay (a ref), not the one captured at render, so several calls in one loop (bulk save) do not overwrite each other
    addCash: (d) => { const o = overlayRef.current; const t = cashToTxn(d, todayISO()); commit({ ...o, manual: [...o.manual, t] }); return t; },
    saveReport: (prompt, spec) => { const id = `r${Date.now()}`; commit({ ...overlay, savedReports: [{ id, createdAt: new Date().toISOString(), prompt, spec }, ...overlay.savedReports] }); return id; },
    deleteReport: (id) => commit({ ...overlay, savedReports: overlay.savedReports.filter((r) => r.id !== id) }),
    patchTxn: (id, patch) => { const o = overlayRef.current; commit({ ...o, patches: { ...o.patches, [id]: { ...o.patches[id], ...patch } } }); },
    links: linkData, reloadLinks,
    tagState, saveTagState: (next) => commit({ ...overlayRef.current, tags: next }),
    income: overlay.income ?? emptyIncome(), saveIncome: (next) => commit({ ...overlayRef.current, income: next }),
    recurring: overlay.recurring ?? emptyRecurring(), saveRecurring: (next) => commit({ ...overlayRef.current, recurring: next }),
    categoryConfig: overlay.categories, saveCategoryConfig: (next) => commit({ ...overlayRef.current, categories: next }),
    attachReceipt: (txnId, lines, uri) => { const o = overlayRef.current; commit({ ...o, patches: { ...o.patches, [txnId]: { ...o.patches[txnId], lines, receiptId: uri } } }); },
    colorOf: (category) => colors.get(category) ?? C.other,
    reset: () => commit(emptyOverlay()),
  }), [ready, hasData, auth, sync, source, accounts, txns, ctx, scope, overlay, questions, dataTo, dataFrom, completeTo, months, period, range, colors, commit, linkData, reloadLinks, tagState]);

  return <Ctx_.Provider value={value}>{children}</Ctx_.Provider>;
}

export function useRepo(): Repo {
  const r = useContext(Ctx_);
  if (!r) throw new Error('useRepo must be used inside RepoProvider');
  return r;
}

export type { CategoryId };
