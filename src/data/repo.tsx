import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { applyAnswer, cashToTxn, undoAnswer } from '@/core/answers';
import { addMonths, monthEnd, monthOf, monthStart, monthsBetween, todayISO } from '@/core/dates';
import { applyOverlay } from '@/core/queries';
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
import type { Account, CategoryId, Overlay, Question, StatementPeriod, Txn } from '@/core/types';
import { useTheme } from '@/theme/theme';
import { setCurrentUser } from './scope';
import { fetchLedger, fetchOverlay, pushOverlay } from './sync';
import { fetchTeamData } from './team';
import { listMembers, myAccess } from './workspace';
import { fetchLinkData, NO_LINKS } from './links';
import type { LinkData } from './links';
import { applyLinks } from '@/core/links';
import { canManage } from '@/core/workspace';
import type { Access, Member } from '@/core/workspace';
import { combineTeam, inView, mergeCategoryConfigs, mergeIncomes, mergeTagStates, ownCategoryConfig, ownIncomeState, ownTagState } from '@/core/team';
import type { PersonData, Viewing } from '@/core/team';
import { colorGroupOf, setCategoryConfig } from '@/core/categories';
import type { CategoryConfig } from '@/core/categories';
import { DEFAULT_TAGS, applyTags } from '@/core/tags';
import type { TagState } from '@/core/tags';
import { projectRef, supabase } from './supabase';
import { fixture, isFixtureKind } from '@/dev/fixture';

const FIXTURE_ENV = process.env.EXPO_PUBLIC_FIXTURE;
/** Development only, and never with a backend: a fictional ledger (src/dev/fixture.ts) so the screens can be seen without anyone's real data. */
const FIXTURE = !supabase && __DEV__ && isFixtureKind(FIXTURE_ENV) ? FIXTURE_ENV : null;
const KEY = FIXTURE ? `audit.overlay.fixture.${FIXTURE}` : 'audit.overlay.v1';
const LEDGER_KEY = 'audit.ledger.v1';
const DIRTY_KEY = 'audit.dirty.v1';
const SYNCED_KEY = 'audit.synced.v1';
const OWNER_KEY = 'audit.owner.v1';
export type Scope = 'all' | 'personal' | 'business';

interface Seed { accounts: Account[]; txns: Txn[]; statements?: StatementPeriod[] }
/** The app ships with no ledger. Statement data comes only from the person's own database. */
const EMPTY: Seed = { accounts: [], txns: [] };

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';
export interface AuthApi {
  /** false when no Supabase project is configured: the app runs fully local */
  configured: boolean;
  email: string | null;
  /** the signed-in person's id, or null */
  userId: string | null;
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
/** An admin's view of their workspace. With no members this is empty and the app behaves as it always did. */
export interface TeamApi {
  access: Access | null;
  /** active members, as the database lists them */
  members: Member[];
  /** the signed-in person's id */
  me: string | null;
  /** 'me', 'all', or a member's id. Always valid: a member who is gone falls back to 'me'. */
  viewing: Viewing;
  setViewing: (v: Viewing) => void;
  /** true when the admin has at least one member, so the switcher is worth showing */
  active: boolean;
  /** one person's own accounts, charges and receipt links exactly as stored (no id prefixes), for adding to their data: 'me' or a member's id */
  dataOf: (who: string) => { accounts: Account[]; txns: Txn[]; links: LinkData | null } | null;
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
  /** take back changes made to a charge, so it shows what the statement says again */
  clearPatch: (id: string, keys: (keyof Overlay['patches'][string])[]) => void;
  /** replace a cash entry with its edited version (same id) */
  updateCash: (t: Txn) => void;
  /** remove a cash entry the person entered */
  removeCash: (id: string) => void;
  attachReceipt: (txnId: string, lines: { item: string; cents: number }[], uri: string) => void;
  /** the tag definitions and the person's changes to tags (always has the tag list, the default one until they change it) */
  tagState: TagState;
  /** change the tag definitions or the tags on a charge or an item */
  saveTagState: (next: TagState) => void;
  /** who is on this person's team, and whose data is on screen */
  team: TeamApi;
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
  /** the fixed colour of a category: one of six colour groups (travel, big-box, groceries, fuel, medical, everything else) */
  colorOf: (category: string) => string;
  reset: () => void;
}

const Ctx_ = createContext<Repo | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const { cat } = useTheme();
  const configured = !!supabase;
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay());
  const [ledger, setLedger] = useState<Seed>(FIXTURE ? fixture(FIXTURE) : EMPTY);
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [team, setTeam] = useState<{ access: Access | null; members: Member[]; data: PersonData[] }>({ access: null, members: [], data: [] });
  const [viewingState, setViewingState] = useState<Viewing>('me');
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
  setCurrentUser(userId);

  // local state first, so the app opens instantly and works offline
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) { const o = { ...emptyOverlay(), ...JSON.parse(raw) } as Overlay; overlayRef.current = o; setOverlay(o); }
        else if (FIXTURE) { const o = fixture(FIXTURE).overlay; overlayRef.current = o; setOverlay(o); }
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
      // a person who manages a workspace also loads their members' data (what comes back is decided by the database, not by this code)
      try {
        const access = await myAccess();
        const members = canManage(access) ? (await listMembers()).filter((m) => m.active) : [];
        setTeam({ access, members, data: members.length ? await fetchTeamData(members.map((m) => m.member)) : [] });
      } catch { setTeam({ access: null, members: [], data: [] }); }
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
          if (live) { setOverlay(emptyOverlay()); setLedger(EMPTY); setLinkData(null); setTeam({ access: null, members: [], data: [] }); setViewingState('me'); setLedgerFrom({ kind: 'none', at: null }); }
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
    userId: session?.user.id ?? null,
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
      setTeam({ access: null, members: [], data: [] }); setViewingState('me');
    },
  }), [configured, session]);
  const sync = useMemo<SyncApi>(() => ({ ...syncInfo, state: configured ? syncInfo.state : 'local', now: syncNow }), [syncInfo, configured, syncNow]);
  const ready = loaded && authReady;
  const source = useMemo<SourceInfo>(() => ({ kind: ledgerFrom.kind, project: projectRef, at: ledgerFrom.at, accounts: ledger.accounts.length, rows: ledger.txns.length }), [ledgerFrom, ledger]);

  const ownTagState_ = useMemo<TagState>(() => ({ defs: overlay.tags?.defs?.length ? overlay.tags.defs : DEFAULT_TAGS, edits: overlay.tags?.edits ?? {} }), [overlay.tags]);
  // with members, "my data plus theirs" is put side by side (see core/team.ts); with none, this is exactly the single-person data it always was
  const combined = useMemo(() => (team.data.length && userId
    ? combineTeam({ id: userId, accounts: ledger.accounts, txns: ledger.txns, overlay, links: linkData, tags: ownTagState_, income: overlay.income ?? emptyIncome() }, team.data)
    : null), [team.data, userId, ledger, overlay, linkData, ownTagState_]);
  const baseAccounts = combined?.accounts ?? ledger.accounts;
  const baseLinks = combined?.links ?? linkData;
  const tagState = combined?.tags ?? ownTagState_;
  const categories = combined?.categories ?? overlay.categories;
  const incomeAll = combined?.income ?? overlay.income ?? emptyIncome();
  const receiptsById = useMemo(() => new Map((baseLinks ?? NO_LINKS).receipts.map((r) => [r.id, r])), [baseLinks]);
  const reloadLinks = useCallback(async () => { setLinkData(await fetchLinkData()); }, []);
  const viewing: Viewing = !team.data.length ? 'me' : viewingState === 'all' || viewingState === 'me' || team.members.some((m) => m.member === viewingState) ? viewingState : 'me';
  // the category list is registered before anything is derived from it, so every screen below sees the person's own categories
  const everyone = useMemo(() => {
    setCategoryConfig(categories);
    return applyTags(applyLinks(applyOverlay(combined?.txns ?? ledger.txns, overlay), baseLinks?.links ?? [], receiptsById, baseLinks?.flags ?? []), tagState);
  }, [combined, ledger, overlay, baseLinks, receiptsById, tagState, categories]);
  // the switcher: everything the screens use is already limited to whose data is on show
  const txns = useMemo(() => (combined && userId && viewing !== 'all' ? everyone.filter((t) => inView(t.owner, viewing, userId)) : everyone), [everyone, combined, userId, viewing]);
  const accounts = useMemo(() => (combined && userId && viewing !== 'all' ? baseAccounts.filter((a) => inView(a.owner, viewing, userId)) : baseAccounts), [baseAccounts, combined, userId, viewing]);
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

  const teamApi = useMemo<TeamApi>(() => ({
    access: team.access, members: team.members, me: userId, viewing, setViewing: setViewingState, active: team.data.length > 0,
    dataOf: (who) => (who === 'me' || who === userId ? { accounts: ledger.accounts, txns: ledger.txns, links: linkData } : team.data.find((m) => m.id === who) ?? null),
  }), [team, userId, viewing, ledger, linkData]);

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
    clearPatch: (id, keys) => {
      const o = overlayRef.current; const cur = { ...(o.patches[id] ?? {}) };
      for (const k of keys) delete cur[k];
      const patches = { ...o.patches };
      if (Object.keys(cur).length) patches[id] = cur; else delete patches[id];
      commit({ ...o, patches });
    },
    // an edited entry is the person's own words again: earlier quick changes to the same entry are dropped so they cannot override the form, except its receipt
    updateCash: (t) => {
      const o = overlayRef.current; const rid = o.patches[t.id]?.receiptId;
      const patches = { ...o.patches }; delete patches[t.id]; if (rid) patches[t.id] = { receiptId: rid };
      commit({ ...o, manual: o.manual.map((x) => (x.id === t.id ? t : x)), patches });
    },
    removeCash: (id) => {
      const o = overlayRef.current; const patches = { ...o.patches }; delete patches[id];
      commit({ ...o, manual: o.manual.filter((x) => x.id !== id), patches });
    },
    links: baseLinks, reloadLinks,
    team: teamApi,
    // what is saved is only the admin's own part: members' tags, categories and income sources stay theirs (see ownTagState and friends in core/team.ts)
    tagState, saveTagState: (next) => commit({ ...overlayRef.current, tags: team.data.length ? ownTagState(next, mergeTagStates({ defs: [], edits: {} }, team.data.map((m) => ({ id: m.id, tags: m.overlay.tags }))), overlayRef.current.tags) : next }),
    income: incomeAll, saveIncome: (next) => commit({ ...overlayRef.current, income: team.data.length ? ownIncomeState(next, mergeIncomes(emptyIncome(), team.data.map((m) => ({ id: m.id, income: m.overlay.income }))), overlayRef.current.income) : next }),
    recurring: overlay.recurring ?? emptyRecurring(), saveRecurring: (next) => commit({ ...overlayRef.current, recurring: next }),
    categoryConfig: categories, saveCategoryConfig: (next) => commit({ ...overlayRef.current, categories: team.data.length ? ownCategoryConfig(next, mergeCategoryConfigs(undefined, team.data.map((m) => m.overlay.categories)), overlayRef.current.categories) : next }),
    attachReceipt: (txnId, lines, uri) => { const o = overlayRef.current; commit({ ...o, patches: { ...o.patches, [txnId]: { ...o.patches[txnId], lines, receiptId: uri } } }); },
    colorOf: (category) => cat[colorGroupOf(category)],
    reset: () => commit(emptyOverlay()),
  }), [ready, hasData, auth, sync, source, accounts, txns, ctx, scope, overlay, questions, dataTo, dataFrom, completeTo, months, period, range, cat, commit, baseLinks, reloadLinks, tagState, incomeAll, categories, team, teamApi]);

  return <Ctx_.Provider value={value}>{children}</Ctx_.Provider>;
}

export function useRepo(): Repo {
  const r = useContext(Ctx_);
  if (!r) throw new Error('useRepo must be used inside RepoProvider');
  return r;
}

export type { CategoryId };
