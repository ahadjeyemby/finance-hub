import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';

import { FieldInput, Findings, ReceiptAgainBox, RereadBox, RowsEditor } from '@/components/intake';
import type { Proposal, ReceiptProposal } from '@/components/intake';
import { ScreenHeader } from '@/components/header';
import { FilePreview } from '@/components/preview';
import { RedactReview } from '@/components/redact';
import { ScanReview } from '@/components/scanner';
import { findSensitive, parseHideWords, withNewSearch } from '@/core/redact';
import { autoTagsFor } from '@/core/tags';
import type { RedactBox } from '@/core/redact';
import { burnRedactions, discardScan, redactionSupported, scanForRedaction } from '@/data/redact';
import type { Scan } from '@/data/redact';
import { discardShot, finishScan, loadShot, scanSupported } from '@/data/scan';
import type { Shot } from '@/data/scan';
import { matchesFilter, progressLine, runPool, separateByKind, splitRepeats, tally } from '@/core/bulk';
import type { BulkStatus, Filter } from '@/core/bulk';
import { allCategories } from '@/core/categories';
import { todayISO } from '@/core/dates';
import { findSameReceipt, keyOf, likelyCharges } from '@/core/dedupe';
import { AUTO_AFTER, applyCardHabit, learnAliases, learnCard, linkTrust, methodKey } from '@/core/learn';
import type { ReceiptKey, Sameness } from '@/core/dedupe';
import { itemLines, likelyRefundCredits, receiptToLines, receiptUnits } from '@/core/evidence';
import type { ReceiptRecord } from '@/core/evidence';
import { acceptReading, acceptReceiptReading, analyseReceipt, analyseStatement, diffReadings, diffReceipts, linkReceipt, noAnswers, planStatement, receiptFieldText, resolveAccount, setReceiptField, setStatementField, statementFieldText } from '@/core/intake';
import type { Analysis, Answers, DocKind, Gap, StatementDraft } from '@/core/intake';
import { dollars } from '@/core/queries';
import { suggestCategory } from '@/core/questions';
import type { Account, Txn } from '@/core/types';
import { accountsWithNumber } from '@/core/accounts';
import { saveLinks, setFlag } from '@/data/links';
import { sweepLinks } from '@/data/linking';
import { NO_LINK_LABEL, RECEIPT_NO_LINK, storedKeys } from '@/core/links';
import type { Link, NoLinkReason } from '@/core/links';
import { canPickFolder, findDuplicate, loadStoredReceipts, makePicked, pickFiles, pickFolder, readReceiptFile, listReaders, readStatementFile, rereadReceiptFile, rereadStatementWithHint, saveReceiptRecord, saveStatementPlan } from '@/data/intake';
import type { PickedFile } from '@/data/intake';
import { useRepo } from '@/data/repo';
import { supabase } from '@/data/supabase';
import { C, R, S } from '@/theme/tokens';
import { Banner, Button, Card, Chip, Row, Screen, Segmented, T } from '@/theme/ui';

interface Item {
  key: string; kind: DocKind; file: PickedFile | null; status: BulkStatus; message?: string;
  receipt?: ReceiptRecord; statement?: StatementDraft;
  answers: Answers; errors: Record<string, string>;
  /** receipts: 'auto' follows the match, 'none' keeps it as evidence only, 'cash' makes a cash purchase, otherwise a ledger transaction id */
  link: string; cat: string | null; edit: boolean;
  /** the original file is shown beside the reading, to compare the two */
  peek?: boolean;
  /** statements: scanned for sensitive details and waiting for the person to check the boxes (status 'redact') */
  redact?: { scan: Scan; boxes: RedactBox[]; busy?: boolean; error?: string };
  /** statements: how many boxes were burned in */
  redactedBoxes?: number;
  /** statements: how redaction ended. 'done' = the redacted copy is what is read and stored; 'skipped' = the person chose the original. */
  redacted?: 'done' | 'skipped';
  /** statements: this number belongs to an existing account (a reissued card, a changed account number), not a new one */
  mergeInto?: string;
  /** receipts with link 'flag': why no charge is expected (paid in cash, from another account...) */
  noLink?: NoLinkReason;
  /** in a long list a row is one line until opened */
  open: boolean;
  /** set once saved: the stored receipt, and the charge it ended up on, so later files can be checked against it */
  savedId?: string; savedTxnId?: string | null;
  /** statements: the person's notes to the reader. `tries` counts re-reads (each is a paid model call), `notes` the notes already accepted. */
  ask?: { open: boolean; busy: boolean; error?: string; proposal?: Proposal; tries: number; notes: string[] };
  /** receipts: a plain "read again", with the new reading held until the person accepts it */
  again?: { busy: boolean; error?: string; proposal?: ReceiptProposal; tries: number };
}
/** The accounts as this statement should be read: with its printed number added to the account the person said it belongs to. */
const statementAccounts = (item: Item, base: Account[]): Account[] => (item.mergeInto && item.statement?.last4 ? accountsWithNumber(base, item.mergeInto, item.statement.last4, 'replaced') : base);
const sameBank = (a: Account, institution?: string) => a.type !== 'cash' && !!institution && institution.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 2 && `${a.institution} ${a.name}`.toLowerCase().includes(w));

type Stored = { id: string; accountId: string | null; periodFrom: string | null; periodTo: string | null };

/** How many files are read at the same time. Each is a paid model call, so this stays small. */
const READ_LANES = 3;
/** Rows drawn before "Show more": a hundred open forms would make the page crawl. */
const PAGE = 40;
/** A list this long switches to one-line rows. */
const COMPACT_FROM = 4;
/** Re-reads with a note, per file. */
const MAX_REREADS = 6;

const RECEIPT_FIELDS: [string, string][] = [['merchant', 'Store'], ['date', 'Date'], ['time', 'Time'], ['total', 'Total paid'], ['subtotal', 'Subtotal'], ['tax', 'Sales tax'], ['tip', 'Tip'], ['paidOther', 'Paid with points, gift card or credit (not the card)'], ['refundTotal', 'Refund total, if any'], ['paymentMethod', 'Paid with'], ['cardLast4', 'Card last 4'], ['storeAddress', 'Store address'], ['storeRef', 'Store number'], ['orderRef', 'Order number']];
const STATEMENT_FIELDS: [string, string][] = [['institution', 'Bank or issuer'], ['last4', 'Account last 4'], ['periodFrom', 'Period start'], ['periodTo', 'Period end'], ['opening', 'Opening balance (card: previous balance owed)'], ['closing', 'Closing balance (card: new balance owed)']];

async function loadStored(): Promise<Stored[]> {
  if (!supabase) return [];
  const q = await supabase.from('statements').select('id, account_id, period_from, period_to');
  return q.error ? [] : (q.data ?? []).map((r) => ({ id: r.id as string, accountId: r.account_id as string | null, periodFrom: r.period_from as string | null, periodTo: r.period_to as string | null }));
}

let counter = 0;
/** Keys must stay unique for as long as the list is on screen. A hot reload restarts `counter` while the list survives, so each load of this file also gets its own prefix. */
const RUN = Math.random().toString(36).slice(2, 6);
const newItem = (kind: DocKind, file: PickedFile | null, extra: Partial<Item> = {}): Item => ({ key: `i${RUN}-${++counter}`, kind, file, status: 'queued', answers: noAnswers(), errors: {}, link: 'auto', cat: null, edit: false, open: false, ...extra });
const NONE: ReadonlySet<string> = new Set<string>();

interface Ctx {
  accounts: Account[]; txns: Txn[]; stored: Stored[];
  /** receipts already stored, for the same-purchase check */
  receipts: ReceiptKey[];
  /** charges that got a receipt earlier in this same save run (the screen has not caught up yet) */
  claimed: ReadonlySet<string>;
  /** store-name pairs and per-card link counts learned from what was confirmed before */
  aliases: ReadonlySet<string>;
  trust: ReadonlyMap<string, number>;
}

/** Everything the card and the Save buttons need to agree on. `before` = receipts earlier in this batch, so of two copies of one purchase the first is the original. */
function evaluate(item: Item, ctx: Ctx, before: ReceiptKey[]) {
  const today = todayISO();
  let analysis: Analysis;
  let linkTxn: Txn | null = null; let candidates: Txn[] = []; let linkPending = false; let cash = false; let cashCat: string | null = null; let second = false;
  let same: Sameness | null = null; let extra = false; let waitingFor: string | null = null; let cashClash: Txn[] = []; let refundCredits: Txn[] = [];
  let matchWhy: string | null = null; let likelyWhy: string | null = null;
  if (item.kind === 'receipt') {
    const rec = item.receipt!;
    same = rec.dup === 'different' ? null : findSameReceipt(rec, [...ctx.receipts, ...before]);
    analysis = analyseReceipt(rec, item.answers, today, same);
    // card digits the person usually uses with this payment method, offered with one tap
    const habit = learnCard([...ctx.receipts, ...before], rec.paymentMethod);
    if (habit) {
      const seen = [{ value: habit.value, count: habit.count }, ...habit.others].slice(0, 3);
      const suggest = seen.map((h, i) => ({ value: h.value, label: `Use ${h.value} (${h.count} earlier ${methodKey(rec.paymentMethod)} receipt${h.count > 1 ? 's' : ''}${i === 0 && seen.length > 1 ? ', the most used' : ''})` }));
      analysis = { ...analysis, gaps: analysis.gaps.map((g) => (g.id === 'cardLast4' ? { ...g, suggest } : g)) };
    }
    refundCredits = likelyRefundCredits(rec, ctx.txns);
    // another document for a purchase already held: it never creates a purchase and never re-splits the items
    extra = !!same && (same.level === 'same' || rec.dup === 'extra');
    if (extra) {
      if (same!.of.id.startsWith('q:')) waitingFor = same!.of.label;
      linkTxn = ctx.txns.find((t) => t.id === same!.of.txnId) ?? null;
      second = !!linkTxn;
    } else {
      // prefer charges that have no receipt yet, so two identical purchases do not collapse into one; fall back to all charges for a second document of the same purchase
      const free = ctx.txns.filter((t) => !t.receiptId && !ctx.claimed.has(t.id));
      const opts = { accounts: ctx.accounts, aliases: ctx.aliases, trusted: (id: string) => (ctx.trust.get(id) ?? 0) >= AUTO_AFTER };
      let m = linkReceipt(rec, free, opts);
      if (!m.txnId && !m.candidates.length) m = linkReceipt(rec, ctx.txns, opts);
      if (m.txnId) matchWhy = m.reason; else if (m.likely) likelyWhy = m.reason;
      candidates = m.candidates.map((id) => ctx.txns.find((t) => t.id === id)).filter((t): t is Txn => !!t);
      if (item.link === 'cash') { cash = true; cashCat = item.cat ?? suggestCategory(rec.merchant ?? '') ?? null; if (!item.answers.acknowledged.includes('cash-dup')) cashClash = likelyCharges(rec, ctx.txns); }
      else if (item.link === 'none' || item.link === 'flag') linkTxn = null;
      else if (item.link !== 'auto') linkTxn = ctx.txns.find((t) => t.id === item.link) ?? null;
      else if (m.txnId) linkTxn = ctx.txns.find((t) => t.id === m.txnId) ?? null;
      else if (candidates.length >= 1) linkPending = true;      // one charge with this amount but another store name is still a question
      second = !!linkTxn && (!!linkTxn.receiptId || ctx.claimed.has(linkTxn.id));
    }
  } else {
    analysis = analyseStatement(item.statement!, { accounts: statementAccounts(item, ctx.accounts), statements: ctx.stored, existing: ctx.txns }, item.answers, today);
  }
  const canSave = analysis.ok && !linkPending && !waitingFor && cashClash.length === 0 && (!cash || !!cashCat);
  return { analysis, linkTxn, candidates, linkPending, cash, cashCat, second, same, extra, waitingFor, cashClash, refundCredits, matchWhy, likelyWhy, canSave };
}
type Ev = ReturnType<typeof evaluate>;

/** Evaluate the whole list in order, each receipt seeing the ones before it. */
function evaluateAll(items: Item[], ctx: Ctx): Map<string, Ev> {
  const out = new Map<string, Ev>(); const before: ReceiptKey[] = [];
  for (const i of items) {
    if (i.status === 'review') out.set(i.key, evaluate(i, ctx, before));
    if (i.receipt && (i.status === 'review' || i.status === 'saving' || i.status === 'saved')) before.push(keyOf(i.receipt, i.savedId ?? `q:${i.key}`, i.file?.name ?? 'a receipt typed by hand', i.savedTxnId));
  }
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Import() {
  const { accounts, txns, hasData, sync, addCash, links, reloadLinks } = useRepo();
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<DocKind>(params.kind === 'receipt' ? 'receipt' : 'statement');
  const [items, setItems] = useState<Item[]>([]);
  const [stored, setStored] = useState<Stored[]>([]);
  const [readers, setReaders] = useState<string[]>([]);
  const [fallbackReceipts, setFallbackReceipts] = useState<ReceiptKey[]>([]);
  // stored receipts with the charge each is linked to: from the links when they are available, else straight from the receipts table
  const receipts = useMemo(() => (links ? storedKeys(links) : fallbackReceipts), [links, fallbackReceipts]);
  const [notice, setNotice] = useState('');
  const [info, setInfo] = useState('');
  // photos taken with the camera wait here, one at a time, to be cropped and cleaned up like a document scan before they join the list
  const [shots, setShots] = useState<{ key: string; file: PickedFile; shot?: Shot; busy?: boolean; error?: string }[]>([]);
  const [scanOn, setScanOn] = useState(true);
  const scanOnRef = useRef(true);
  useEffect(() => {
    AsyncStorage.getItem('audit.scan.v1').then((raw) => { if (raw === 'off') { setScanOn(false); scanOnRef.current = false; } }).catch(() => {});
  }, []);
  const setScanSetting = (on: boolean) => { setScanOn(on); scanOnRef.current = on; AsyncStorage.setItem('audit.scan.v1', on ? 'on' : 'off').catch(() => {}); };
  const first = shots[0];
  useEffect(() => {
    if (!first || first.shot || first.error) return;
    let alive = true;
    loadShot(first.file.bytes, first.file.type)
      .then((shot) => { if (alive) setShots((xs) => xs.map((x) => (x.key === first.key ? { ...x, shot } : x))); else discardShot(shot); })
      .catch((e) => { if (alive) setShots((xs) => xs.map((x) => (x.key === first.key ? { ...x, error: `Could not open this photo for scanning (${(e as Error).message}). Use it as taken, or discard it.` } : x))); });
    return () => { alive = false; };
  }, [first]);
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const connected = !!supabase;

  // The async work below must see the newest list and ledger, not the ones from the render that started it.
  const itemsRef = useRef<Item[]>([]);
  const learned = useMemo(() => ({ aliases: learnAliases(receipts, txns), trust: linkTrust(receipts, txns, accounts) }), [receipts, txns, accounts]);
  const ctx: Ctx = { accounts, txns, stored, receipts, claimed: NONE, ...learned };
  const ctxRef = useRef<Ctx>(ctx);
  useEffect(() => { ctxRef.current = { accounts, txns, stored, receipts, claimed: NONE, ...learned }; });
  const savedKeysRef = useRef<ReceiptKey[]>([]);
  const claimedRef = useRef<Set<string>>(new Set());
  const stopRef = useRef(false);
  // redaction settings: on by default where it can run (the web version), kept on this device only
  const [redactOn, setRedactOn] = useState(true);
  const [hideText, setHideText] = useState('');
  const redactOnRef = useRef(true);
  const hideRef = useRef('');
  useEffect(() => {
    AsyncStorage.getItem('audit.redact.v1').then((raw) => {
      if (!raw) return;
      try { const v = JSON.parse(raw) as { on?: boolean; words?: string }; if (typeof v.on === 'boolean') { setRedactOn(v.on); redactOnRef.current = v.on; } if (typeof v.words === 'string') { setHideText(v.words); hideRef.current = v.words; } } catch { /* unreadable settings: keep the defaults */ }
    }).catch(() => {});
  }, []);
  const saveRedactSettings = (on: boolean, words: string) => {
    setRedactOn(on); setHideText(words); redactOnRef.current = on; hideRef.current = words;
    AsyncStorage.setItem('audit.redact.v1', JSON.stringify({ on, words })).catch(() => {});
  };

  useEffect(() => {
    let on = true;
    loadStored().then((s) => { if (on) setStored(s); });
    loadStoredReceipts().then((r) => { if (on) setFallbackReceipts(r); });
    listReaders().then((m) => { if (on) setReaders(m); });
    return () => { on = false; };
  }, []);

  const update = (f: (xs: Item[]) => Item[]) => { itemsRef.current = f(itemsRef.current); setItems(itemsRef.current); };
  const patch = (key: string, f: (i: Item) => Item) => update((xs) => xs.map((x) => (x.key === key ? f(x) : x)));
  const live = (key: string) => itemsRef.current.find((x) => x.key === key);

  /** wait (briefly) for the screen to pick up a ledger change made by a save, so the next file is checked against it */
  const settle = async (prev: Txn[]) => { for (let i = 0; i < 20 && ctxRef.current.txns === prev; i++) await pause(50); };

  const read = async (item: Item) => {
    if (!live(item.key)) return;                       // discarded while waiting
    patch(item.key, (x) => ({ ...x, status: 'reading' }));
    try {
      if (item.file) {
        const dup = await findDuplicate(item.kind, item.file.sha256);
        if (dup.duplicateOf) return patch(item.key, (x) => ({ ...x, status: 'duplicate', message: `Already stored: ${dup.duplicateOf}. Nothing was changed.` }));
      }
      // a statement is scanned for sensitive details on this device first; reading waits until the person has checked what will be blacked out
      if (item.kind === 'statement' && item.file && redactionSupported && redactOnRef.current && !item.redacted) {
        const hide = parseHideWords(hideRef.current);
        patch(item.key, (x) => ({ ...x, message: 'Scanning for sensitive details. This happens on your device; nothing is sent anywhere.' }));
        const scan = await scanForRedaction(item.file.bytes, item.file.type, hide, (m) => patch(item.key, (x) => (x.status === 'reading' ? { ...x, message: `${m}. This happens on your device; nothing is sent anywhere.` } : x)));
        if (!live(item.key)) return discardScan(scan);
        return patch(item.key, (x) => ({ ...x, status: 'redact', message: undefined, redact: { scan, boxes: scan.boxes } }));
      }
      if (item.kind === 'receipt') { const r = applyCardHabit(await readReceiptFile(item.file!), [...ctxRef.current.receipts, ...savedKeysRef.current]); patch(item.key, (x) => ({ ...x, status: 'review', receipt: r })); }
      else {
        const d = await readStatementFile(item.file!);
        // the saved statement says whether what was read is the redacted copy
        patch(item.key, (x) => ({ ...x, status: 'review', statement: x.redacted ? { ...d, raw: { ...(d.raw ?? {}), redaction: x.redacted === 'done' ? { applied: true, boxes: x.redactedBoxes ?? 0 } : { applied: false, skipped: true } } } : d }));
      }
    } catch (e) { patch(item.key, (x) => ({ ...x, status: 'failed', message: (e as Error).message })); }
  };

  /** Read everything waiting, a few at a time. Safe to call again: it only takes rows still marked waiting. */
  const processQueue = async () => {
    const waiting = itemsRef.current.filter((i) => i.status === 'queued');
    if (!waiting.length) return;
    stopRef.current = false; setReading(true);
    await runPool(waiting, READ_LANES, read, () => stopRef.current);
    setReading(false);
  };

  /** Change the boxes of a statement waiting for redaction review. */
  const setRedactBoxes = (key: string, boxes: RedactBox[]) => patch(key, (x) => (x.redact ? { ...x, redact: { ...x.redact, boxes, error: undefined } } : x));
  const searchAgain = (key: string, words: string[], text: string) => {
    saveRedactSettings(redactOnRef.current, text);
    patch(key, (x) => (x.redact ? { ...x, redact: { ...x.redact, boxes: withNewSearch(x.redact.boxes, findSensitive(x.redact.scan.words, { hide: words })) } } : x));
  };
  /** Burn the switched-on boxes into the pictures of the pages, replace the file with the redacted copy (the original is dropped from memory), and let it be read. */
  const approveRedaction = async (key: string) => {
    const cur = live(key);
    if (!cur?.redact || !cur.file) return;
    patch(key, (x) => (x.redact ? { ...x, redact: { ...x.redact, busy: true, error: undefined } } : x));
    try {
      const out = await burnRedactions(cur.redact.scan, cur.redact.boxes, cur.file.type === 'application/pdf');
      const n = cur.redact.boxes.filter((b) => b.on).length;
      discardScan(cur.redact.scan);
      // the file keeps the fingerprint of the original, so the same statement is still recognised as already imported
      patch(key, (x) => ({ ...x, status: 'queued', redact: undefined, redacted: 'done', redactedBoxes: n, file: x.file ? { ...x.file, bytes: out.bytes, type: out.type } : x.file }));
      await processQueue();
    } catch (e) { patch(key, (x) => (x.redact ? { ...x, redact: { ...x.redact, busy: false, error: (e as Error).message } } : x)); }
  };
  const skipRedaction = async (key: string) => {
    const cur = live(key);
    if (cur?.redact) discardScan(cur.redact.scan);
    patch(key, (x) => ({ ...x, status: 'queued', redact: undefined, redacted: 'skipped' }));
    await processQueue();
  };
  const discardRedaction = (key: string) => {
    const cur = live(key);
    if (cur?.redact) discardScan(cur.redact.scan);
    update((xs) => xs.filter((x) => x.key !== key));
  };

  const add = async (source: 'files' | 'photos' | 'camera' | 'folder') => {
    setNotice(''); setInfo('');
    let files: PickedFile[] = []; let skipped: string[] = [];
    try {
      if (source === 'folder') { const p = await pickFolder(); files = p.files; skipped = p.skipped; }
      else files = await pickFiles(source);
    } catch (e) { return setNotice((e as Error).message); }
    if (!files.length && !skipped.length) return;
    if (source === 'camera' && scanSupported && scanOnRef.current && files.length) {
      setShots((xs) => [...xs, ...files.map((file, i) => ({ key: `shot-${Date.now()}-${i}`, file }))]);
      return;
    }
    await admit(files, skipped);
  };
  /** Add picked files to the list: sorted by kind, repeats left out, the rest queued to be read. */
  const admit = async (files: PickedFile[], skipped: string[]) => {
    const sep = separateByKind(files, kind);
    const known = new Set(itemsRef.current.flatMap((i) => (i.file ? [i.file.sha256] : [])));
    const { fresh, repeats } = splitRepeats(sep.fit, known);
    const notes: string[] = [];
    if (sep.other.length) notes.push(`${sep.other.length} ${sep.other.length === 1 ? 'file looks' : 'files look'} like ${kind === 'receipt' ? 'statements' : 'receipts'} and ${sep.other.length === 1 ? 'was' : 'were'} left out. Switch the choice above to add ${sep.other.length === 1 ? 'it' : 'them'}.`);
    if (skipped.length) notes.push(`Skipped ${skipped.length} that ${skipped.length === 1 ? 'is' : 'are'} not a PDF or image: ${skipped.slice(0, 3).map((n) => n.split('/').pop()).join(', ')}${skipped.length > 3 ? ' and more' : ''}.`);
    if (repeats.length) notes.push(`${repeats.length} repeated ${repeats.length === 1 ? 'file' : 'files'} skipped before reading, so nothing is paid for twice.`);
    setInfo(notes.join(' '));
    if (!fresh.length && !repeats.length) return;
    setFilter('all'); setLimit(PAGE);
    update((xs) => [
      ...xs,
      ...repeats.map((r) => newItem(kind, r.file, { status: 'duplicate', message: `Same file as ${r.of}. Skipped.` })),
      ...fresh.map((f) => newItem(kind, f)),
    ]);
    await processQueue();
  };
  const dropShot = (key: string) => setShots((xs) => { const x = xs.find((s) => s.key === key); if (x?.shot) discardShot(x.shot); return xs.filter((s) => s.key !== key); });
  const acceptScan = async (key: string, quad: Parameters<typeof finishScan>[1], mode: Parameters<typeof finishScan>[2], turns: number) => {
    const cur = shots.find((x) => x.key === key);
    if (!cur?.shot) return;
    setShots((xs) => xs.map((x) => (x.key === key ? { ...x, busy: true, error: undefined } : x)));
    try {
      const out = await finishScan(cur.shot, quad, mode, turns);
      const file = await makePicked(`${cur.file.name.replace(/\.[^.]+$/, '')}-scan.jpg`, out.bytes, out.type);
      dropShot(key);
      await admit([file], []);
    } catch (e) { setShots((xs) => xs.map((x) => (x.key === key ? { ...x, busy: false, error: (e as Error).message } : x))); }
  };
  const acceptOriginal = async (key: string) => {
    const cur = shots.find((x) => x.key === key);
    if (!cur) return;
    dropShot(key);
    await admit([cur.file], []);
  };
  const typeByHand = () => update((xs) => [...xs, newItem('receipt', null, { status: 'review', receipt: { lines: [] }, open: true })]);
  const stop = () => { stopRef.current = true; };
  const retryFailed = async () => { update((xs) => xs.map((x) => (x.status === 'failed' && x.file ? { ...x, status: 'queued', message: undefined } : x))); await processQueue(); };

  /** any change to the data clears earlier "keep as printed" confirmations: they applied to the old numbers */
  const edited = (x: Item, over: Partial<Item>): Item => ({ ...x, ...over, answers: { ...x.answers, acknowledged: [] }, errors: {} });
  const answer = (item: Item, field: string, id: string, text: string) => {
    if (item.kind === 'receipt') {
      const r = setReceiptField(item.receipt!, field, text);
      patch(item.key, (x) => (r.error ? { ...x, errors: { ...x.errors, [id]: r.error! } } : edited(x, { receipt: r.record })));
    } else {
      const r = setStatementField(item.statement!, field, text);
      patch(item.key, (x) => (r.error ? { ...x, errors: { ...x.errors, [id]: r.error! } } : edited(x, { statement: r.draft })));
    }
  };
  const setAsk = (key: string, over: Partial<NonNullable<Item['ask']>>) => patch(key, (x) => ({ ...x, ask: { open: false, busy: false, tries: 0, notes: [], ...x.ask, ...over } }));
  const reread = async (item: Item, hint: string, model?: string) => {
    const cur = live(item.key);
    if (!cur?.file || !cur.statement || cur.ask?.busy || (cur.ask?.tries ?? 0) >= MAX_REREADS) return;
    setAsk(item.key, { busy: true, error: undefined, tries: (cur.ask?.tries ?? 0) + 1 });
    try {
      const draft = await rereadStatementWithHint(cur.file, cur.statement, hint, model);
      const now = live(item.key);
      // the person may have edited the draft while the reader worked: compare with what is on screen now
      setAsk(item.key, { busy: false, open: false, proposal: { draft, diff: diffReadings(now?.statement ?? cur.statement, draft), hint } });
    } catch (e) { setAsk(item.key, { busy: false, error: (e as Error).message }); }
  };
  const setAgain = (key: string, over: Partial<NonNullable<Item['again']>>) => patch(key, (x) => ({ ...x, again: { busy: false, tries: 0, ...x.again, ...over } }));
  const retryReceipt = async (item: Item, model?: string, hint?: string) => {
    const cur = live(item.key);
    if (!cur?.file || !cur.receipt || cur.again?.busy || (cur.again?.tries ?? 0) >= MAX_REREADS) return;
    const tries = (cur.again?.tries ?? 0) + 1;
    setAgain(item.key, { busy: true, error: undefined, tries });
    try {
      const record = applyCardHabit(await rereadReceiptFile(cur.file, tries, model, hint, cur.receipt), [...ctxRef.current.receipts, ...savedKeysRef.current]);
      const now = live(item.key);
      setAgain(item.key, { busy: false, proposal: { record, diff: diffReceipts(now?.receipt ?? cur.receipt, record), hint } });
    } catch (e) { setAgain(item.key, { busy: false, error: (e as Error).message }); }
  };
  const takeReceiptReading = (item: Item) => patch(item.key, (x) => {
    const p = x.again?.proposal;
    if (!p || !x.receipt) return x;
    return { ...edited(x, { receipt: acceptReceiptReading(x.receipt, p.record, p.hint) }), again: { busy: false, tries: x.again?.tries ?? 0 } };
  });
  const takeReading = (item: Item) => patch(item.key, (x) => {
    const p = x.ask?.proposal;
    if (!p) return x;
    const notes = [...(x.ask?.notes ?? []), p.hint].filter(Boolean);
    return { ...edited(x, { statement: acceptReading(p.draft, notes) }), ask: { open: false, busy: false, tries: x.ask?.tries ?? 0, notes } };
  });
  const skip = (item: Item, g: Gap) => patch(item.key, (x) => ({ ...x, answers: { ...x.answers, notPrinted: [...x.answers.notPrinted, g.id] } }));
  const acknowledge = (item: Item, id: string) => patch(item.key, (x) => ({ ...x, answers: { ...x.answers, acknowledged: [...x.answers.acknowledged, id] } }));

  const save = async (key: string) => {
    const item = live(key);
    if (!item || item.status !== 'review') return;
    const cx: Ctx = { ...ctxRef.current, receipts: [...ctxRef.current.receipts, ...savedKeysRef.current], claimed: claimedRef.current };
    const ev = evaluateAll(itemsRef.current, cx).get(key);
    if (!ev || !ev.canSave) return;
    let savedId: string | undefined; let savedTxnId: string | null = null;
    patch(key, (x) => ({ ...x, status: 'saving', message: undefined }));
    try {
      let message: string;
      if (item.kind === 'receipt') {
        const rec = item.receipt!;
        const link = ev.linkTxn;
        const original = ev.extra && ev.same && !ev.same.of.id.startsWith('q:') ? ev.same.of : null;
        // the link is its own record (receipt_links), so the receipt row is saved without one
        const rid = await saveReceiptRecord(original ? { ...rec, duplicateOf: original.id } : rec, item.file, null);
        savedId = rid; savedTxnId = link?.id ?? original?.txnId ?? null;
        const mk = (txnId: string, role: Link['role']): Link => {
          const chosen = item.link !== 'auto';
          const method = chosen ? 'confirmed' : ev.matchWhy === 'order number' ? 'order_number' : /card/.test(ev.matchWhy ?? '') ? 'card' : 'store';
          return { receiptId: rid, txnId, role, method, reason: chosen ? 'chosen by you' : ev.matchWhy ?? null, confirmed: chosen };
        };
        const toSave: Link[] = [];
        if (ev.extra) {
          if (link) claimedRef.current.add(link.id);
          if (savedTxnId) toSave.push({ ...mk(savedTxnId, 'extra'), method: 'store', reason: ev.same!.why, confirmed: false });
          message = `Saved as an extra document for ${ev.same!.of.label}${link ? `, the ${link.date} charge at ${link.merchant}` : ''}. No new purchase was added and its items were not split again.`;
        } else if (link) {
          claimedRef.current.add(link.id);
          if (ev.second) { toSave.push(mk(link.id, 'extra')); message = `Saved as an extra document for ${link.merchant}, ${link.date}, ${dollars(-link.cents)}. That charge already had a receipt, so its items were not split again.`; }
          else {
            toSave.push(mk(link.id, 'primary'));
            message = `Saved and linked to ${link.merchant}, ${link.date}, ${dollars(-link.cents)}.`;
          }
        } else if (ev.cash) {
          const t = addCash({ amount: (rec.totalCents ?? 0) / 100, merchant: rec.merchant ?? 'Receipt', what: 'Receipt', category: ev.cashCat!, date: rec.date!, business: false, oneOff: false, splitAsked: true, receiptId: rid, lines: receiptToLines(rec, rec.totalCents ?? 0).map((l) => ({ item: l.item, amount: l.cents / 100 })) });
          savedTxnId = t.id;
          toSave.push({ receiptId: rid, txnId: t.id, role: 'primary', method: 'manual', reason: 'entered as a cash purchase', confirmed: true });
          message = 'Saved and added as a cash purchase.';
        } else if (item.link === 'flag') {
          await setFlag('receipt', rid, item.noLink ?? 'cash');
          message = `Saved. Marked as: ${NO_LINK_LABEL[item.noLink ?? 'cash'].toLowerCase()}, so no charge is expected.`;
        } else message = 'Saved as evidence. It is not linked to a charge yet. Open Links to match it when its statement is imported.';
        if (toSave.length) await saveLinks(toSave);
        await reloadLinks();
      } else {
        const plan = planStatement(item.statement!, { accounts: statementAccounts(item, cx.accounts), statements: cx.stored, existing: cx.txns }, { name: item.file?.name ?? 'statement', sha256: item.file?.sha256 });
        await saveStatementPlan(plan, item.file);
        await sync.now();
        setStored(await loadStored());
        await settle(cx.txns);
        // receipts saved earlier may now have their charge: link the clear ones, leave the likely ones for the person to confirm
        let swept: Awaited<ReturnType<typeof sweepLinks>> = null;
        try { swept = await sweepLinks(ctxRef.current.txns, ctxRef.current.accounts); if (swept) await reloadLinks(); } catch { /* the statement is saved; links can be found later from the Links screen */ }
        message = plan.txns.length === 0 && plan.skipped.length
          ? `Nothing new: all ${plan.skipped.length} rows were already in your ledger. The statement itself was recorded.`
          : `Saved ${plan.txns.length} transactions to ${plan.account.name}${plan.isNewAccount ? ' (new account)' : ''}${plan.pairUpdates.length ? `, linked ${plan.pairUpdates.length} card payment${plan.pairUpdates.length > 1 ? 's' : ''}` : ''}.${plan.skipped.length ? ` ${plan.skipped.length} ${plan.skipped.length === 1 ? 'row was' : 'rows were'} already in your ledger and not added again.` : ''}`;
        if (swept?.saved) message += ` Linked ${swept.saved} receipt${swept.saved > 1 ? 's' : ''} you had saved earlier.`;
        if (swept?.suggested) message += ` ${swept.suggested} more look${swept.suggested > 1 ? '' : 's'} like a match: confirm ${swept.suggested > 1 ? 'them' : 'it'} in Links.`;
      }
      // the original is stored; drop its bytes from memory so a long run does not hold every photo
      if (savedId) savedKeysRef.current.push(keyOf(item.receipt!, savedId, item.file?.name ?? 'a receipt typed by hand', savedTxnId));
      patch(key, (x) => ({ ...x, status: 'saved', message, open: false, savedId, savedTxnId, file: x.file ? { ...x.file, bytes: new Uint8Array(0) } : null }));
    } catch (e) { patch(key, (x) => ({ ...x, status: 'review', message: (e as Error).message })); }
  };

  /** Statements first: they add the charges that receipts then link to. One at a time, so each file is checked against the one before it. */
  const saveAll = async () => {
    stopRef.current = false; setSaving(true);
    // Passes, because saving one file can unlock another: a second document of a purchase waits for the first to be stored.
    const tried = new Set<string>();
    for (let pass = 0; pass < 6 && !stopRef.current; pass++) {
      const evs = evaluateAll(itemsRef.current, { ...ctxRef.current, receipts: [...ctxRef.current.receipts, ...savedKeysRef.current], claimed: claimedRef.current });
      const keys = itemsRef.current
        .filter((i) => i.status === 'review' && !tried.has(i.key) && evs.get(i.key)?.canSave)
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'statement' ? -1 : 1))
        .map((i) => i.key);
      if (!keys.length) break;
      for (const k of keys) { if (stopRef.current) break; tried.add(k); await save(k); }
      await pause(60);                        // let the screen take in what was just stored
    }
    setSaving(false);
  };

  const evals = evaluateAll(items, ctx);
  const t = tally(items.map((i) => ({ status: i.status, ready: !!evals.get(i.key)?.canSave })));
  const compact = items.length >= COMPACT_FROM;
  const sideBySide = useWindowDimensions().width >= 1000;
  const anyPeek = items.some((i) => i.peek);
  const visible = items.filter((i) => matchesFilter(filter, i.status, !!evals.get(i.key)?.canSave));
  const shown = visible.slice(0, limit);

  return (
    <Screen max={anyPeek && sideBySide ? 1400 : 760}>
      <ScreenHeader back title="Import" sub="Every receipt and statement is read and checked first. Nothing is saved until every detail is accounted for." right={<View style={{ flexDirection: 'row', gap: S.sm }}><Button small kind="outline" label="Accounts" onPress={() => router.push('/accounts')} /><Button small kind="outline" label="Receipt links" onPress={() => router.push('/links')} /></View>} />
      {!connected ? <Banner title="No database is connected.">Set the Supabase URL and anon key in .env first. Nothing can be saved without it.</Banner> : null}
      <Card title="What are you adding?">
        <Segmented value={kind} onChange={setKind} options={[{ value: 'statement', label: 'Statements' }, { value: 'receipt', label: 'Receipts' }]} />
        <T size={13} tone="ink2">{kind === 'statement' ? 'Bank or card statements, one PDF per month, or photos of its pages.' : 'Store receipts or order confirmations, as photos or PDFs.'} {canPickFolder ? 'Choose a whole folder, or select as many files as you like.' : 'Select as many files or photos as you like.'}</T>
        {kind === 'statement' && redactionSupported ? (
          <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
            <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip label="Redact statements first" on={redactOn} onPress={() => saveRedactSettings(!redactOn, hideText)} />
              <T size={12} tone="ink3">{redactOn ? 'On' : 'Off: statements are read exactly as they are'}</T>
            </View>
            <T size={12} tone="ink3">{redactOn ? 'Each statement is scanned for account numbers, names, addresses and similar on your device, with no outside service. You check every box before anything is read or stored, and the reader only ever sees the redacted copy.' : 'Turn this on to black out sensitive details before a statement is read or stored.'}</T>
          </View>
        ) : null}
        {scanSupported ? (
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label="Scan photos taken here" on={scanOn} onPress={() => setScanSetting(!scanOn)} />
            <T size={12} tone="ink3">{scanOn ? 'A photo from Take a photo is cropped to the paper, straightened and cleaned up in black and white, on your device. You check the crop first.' : 'Off: photos are used exactly as taken'}</T>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          {canPickFolder ? <Button label="Choose a folder" disabled={!connected} onPress={() => add('folder')} /> : null}
          <Button kind={canPickFolder ? 'outline' : 'solid'} label="Choose files" disabled={!connected} onPress={() => add('files')} />
          <Button kind="outline" label="Choose photos" disabled={!connected} onPress={() => add('photos')} />
          <Button kind="outline" label="Take a photo" disabled={!connected} onPress={() => add('camera')} />
          {kind === 'receipt' ? <Button kind="ghost" label="Type a receipt by hand" onPress={typeByHand} /> : null}
        </View>
        <T size={12} tone="ink3">Files are sent to the AI model your backend uses to read them (set by OPENROUTER_MODEL), with provider data collection denied unless you changed that. Statements show account numbers: read them only if you accept that. Each file is one model call, so a large folder takes a while and costs per file.</T>
        {notice ? <T size={13} tone="bad">{notice}</T> : null}
        {info ? <T size={13} tone="ink2">{info}</T> : null}
      </Card>

      {!hasData && !items.length ? <Banner tone="info" title="Your database is empty.">Import your first statement above. Receipts can be added once there are transactions to link them to.</Banner> : null}

      {items.length > 1 ? (
        <Card title="Progress">
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: t.total, now: t.done }} style={{ height: 6, borderRadius: R.pill, backgroundColor: C.ground, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${Math.round((t.done / t.total) * 100)}%`, backgroundColor: C.ink }} />
          </View>
          <T size={13} tone="ink2">{progressLine(t)}.</T>
          {t.ready && reading ? <T size={12} tone="ink3">Save all unlocks when reading finishes, so every file is checked against the others first.</T> : null}
          {t.attention && !reading ? <T size={12} tone="ink3">Rows marked “Needs attention” are missing a detail or have numbers that disagree. Open them under “Needs answers”.</T> : null}
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            {reading ? <Button small kind="outline" label="Stop reading" onPress={stop} /> : t.waiting ? <Button small kind="outline" label={`Resume reading (${t.waiting} waiting)`} onPress={processQueue} /> : null}
            {t.ready ? <Button label={saving ? 'Saving' : `Save all ${t.ready} ready`} disabled={saving || reading} onPress={saveAll} /> : null}
            {saving ? <Button small kind="outline" label="Stop saving" onPress={stop} /> : null}
            {t.failed && !reading ? <Button small kind="outline" label={`Try ${t.failed} failed again`} onPress={retryFailed} /> : null}
            {t.saved ? <Button small kind="ghost" label="Clear saved" onPress={() => update((xs) => xs.filter((x) => x.status !== 'saved'))} /> : null}
          </View>
        </Card>
      ) : null}

      {items.length >= COMPACT_FROM ? (
        <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
          {([['all', 'All', t.total], ['attention', 'Needs answers', t.attention], ['ready', 'Ready', t.ready], ['problems', 'Problems', t.failed + t.duplicate], ['saved', 'Saved', t.saved]] as [Filter, string, number][]).map(([f, label, n]) => (
            <Chip key={f} label={label} count={n} on={filter === f} onPress={() => { setFilter(f); setLimit(PAGE); }} />
          ))}
        </View>
      ) : null}

      {first ? (
        <Card key={first.key} title={first.file.name} right={<T size={12} tone="ink3" bold>{shots.length > 1 ? `Scan 1 of ${shots.length}` : 'Check the scan'}</T>}>
          {first.shot ? (
            <ScanReview key={first.key} shot={first.shot} busy={!!first.busy} error={first.error}
              onUse={(q, m, t) => acceptScan(first.key, q, m, t)} onOriginal={() => acceptOriginal(first.key)} onDiscard={() => dropShot(first.key)} />
          ) : first.error ? (
            <View style={{ gap: S.sm }}>
              <T size={13} tone="bad">{first.error}</T>
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Button small kind="outline" label="Use the photo as taken" onPress={() => acceptOriginal(first.key)} />
                <Button small kind="ghost" label="Discard this photo" onPress={() => dropShot(first.key)} />
              </View>
            </View>
          ) : <T size={13} tone="ink2">Looking for the paper in the photo. This happens on your device.</T>}
        </Card>
      ) : null}

      {shown.map((item) => {
        const ev = evals.get(item.key);
        const peeking = !!item.peek && !!item.file && item.file.bytes.length > 0 && (item.status === 'review' || item.status === 'saving');
        if (item.status === 'redact' && item.redact) {
          return (
            <Card key={item.key} title={item.file?.name ?? 'Statement'} right={<T size={12} tone="ink3" bold>Check redaction</T>}>
              <RedactReview scan={item.redact.scan} boxes={item.redact.boxes} hideText={hideText} busy={!!item.redact.busy} error={item.redact.error}
                onBoxes={(b) => setRedactBoxes(item.key, b)} onSearch={(w, t) => searchAgain(item.key, w, t)}
                onApprove={() => approveRedaction(item.key)} onSkip={() => skipRedaction(item.key)} onDiscard={() => discardRedaction(item.key)} />
            </Card>
          );
        }
        if (compact && !item.open && (item.status === 'queued' || item.status === 'reading' || item.status === 'saving' || item.status === 'saved')) return <Line key={item.key} item={item} />;
        if (compact && !item.open && item.status === 'review' && ev) return <Summary key={item.key} item={item} ev={ev} accounts={accounts} onOpen={() => patch(item.key, (x) => ({ ...x, open: true }))} onSave={() => save(item.key)} onRemove={() => update((xs) => xs.filter((x) => x.key !== item.key))} />;
        const card = (
          <ItemCard key={item.key} item={item} ev={ev} accounts={accounts}
            onAnswer={(field, id, text) => answer(item, field, id, text)} onSkip={(g) => skip(item, g)} onAcknowledge={(id) => acknowledge(item, id)}
            onStatement={(d) => patch(item.key, (x) => edited(x, { statement: d }))}
            onSet={(over) => patch(item.key, (x) => ({ ...x, ...over }))} onSave={() => save(item.key)}
            onCollapse={compact && item.status === 'review' ? () => patch(item.key, (x) => ({ ...x, open: false })) : undefined}
            readers={readers} onReread={(text, model) => reread(item, text, model)} onToggleAsk={() => setAsk(item.key, { open: !item.ask?.open, error: undefined })} onUseReading={() => takeReading(item)} onKeepReading={() => setAsk(item.key, { proposal: undefined })}
            onRetryReceipt={(model, hint) => retryReceipt(item, model, hint)} onUseReceipt={() => takeReceiptReading(item)} onKeepReceipt={() => setAgain(item.key, { proposal: undefined })}
            onRetryByHand={() => patch(item.key, (x) => ({ ...x, status: 'review', message: undefined, open: true, receipt: x.kind === 'receipt' ? { lines: [] } : undefined, statement: x.kind === 'statement' ? { rows: [] } : undefined }))}
            onRemove={() => update((xs) => xs.filter((x) => x.key !== item.key))} />
        );
        if (!peeking) return card;
        // the original goes to the right of the reading on a wide screen, and under it on a narrow one
        const original = <FilePreview file={item.file!} onClose={() => patch(item.key, (x) => ({ ...x, peek: false }))} />;
        return sideBySide
          ? <View key={item.key} style={{ flexDirection: 'row', gap: S.lg, alignItems: 'flex-start' }}><View style={{ flex: 1, minWidth: 0 }}>{card}</View><View style={{ flex: 1, minWidth: 0, ...(Platform.OS === 'web' ? ({ position: 'sticky', top: S.lg } as object) : {}) }}>{original}</View></View>
          : <View key={item.key} style={{ gap: S.md }}>{card}{original}</View>;
      })}
      {visible.length > shown.length ? <Button kind="outline" label={`Show ${Math.min(PAGE, visible.length - shown.length)} more (${visible.length - shown.length} hidden)`} onPress={() => setLimit(limit + PAGE)} /> : null}
      {items.length && !visible.length ? <T size={13} tone="ink3">Nothing in this list.</T> : null}

      {items.some((i) => i.status === 'saved') ? <View style={{ flexDirection: 'row', gap: S.sm }}><Button kind="outline" label="Back to Overview" onPress={() => router.replace('/')} /></View> : null}
    </Screen>
  );
}

const STATUS_TEXT: Record<BulkStatus, string> = { queued: 'Waiting', reading: 'Reading', redact: 'Check redaction', review: '', saving: 'Saving', saved: 'Saved', failed: 'Not read', duplicate: 'Skipped' };

/** One line for a file that is waiting, being read, saving, or already saved. */
function Line({ item }: { item: Item }) {
  return (
    <View style={{ gap: 2, paddingVertical: S.xs, paddingHorizontal: S.md, backgroundColor: C.paper, borderRadius: R.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
        <View style={{ flex: 1 }}><T size={13} numberOfLines={1}>{item.file?.name ?? 'Receipt typed by hand'}</T></View>
        <T size={12} tone={item.status === 'saved' ? 'good' : 'ink3'} bold={item.status === 'saved'}>{STATUS_TEXT[item.status]}</T>
      </View>
      {item.status === 'saved' && item.message ? <T size={12} tone="ink2">{item.message}</T> : null}
    </View>
  );
}

/** The tags the items on a receipt would get, as counts: Health 2, Household 1. Read only here; each item's tags are changed on its charge once it is linked. */
function TagNote({ lines }: { lines: { item: string; cents: number }[] }) {
  const { tagState } = useRepo();
  const counts = new Map<string, { n: number; cents: number }>();
  for (const l of lines) for (const id of autoTagsFor(l.item, undefined, undefined, tagState.defs)) { const e = counts.get(id) ?? { n: 0, cents: 0 }; e.n++; e.cents += l.cents; counts.set(id, e); }
  if (!counts.size) return null;
  return <T size={12} tone="ink3">Tags found from the items: {[...counts.entries()].map(([id, e]) => `${tagState.defs.find((d) => d.id === id)?.label ?? id} ${e.n} (${dollars(e.cents)})`).join(', ')}. Change them per item on the charge page once the receipt is linked.</T>;
}

function summaryLine(item: Item, accounts: Account[]): string {
  if (item.receipt) { const r = item.receipt; return `${r.merchant || 'Store missing'}, ${r.date ?? 'date missing'}, ${r.totalCents != null ? dollars(r.totalCents) : 'total missing'}, ${r.lines.length} ${r.lines.length === 1 ? 'item' : 'items'}`; }
  const s = item.statement!;
  const acct = resolveAccount(s, accounts);
  return `${acct ? acct.name : s.institution && s.last4 ? `New: ${s.institution} ${s.last4}` : 'Account unknown'}, ${s.periodFrom && s.periodTo ? `${s.periodFrom} to ${s.periodTo}` : 'period missing'}, ${s.rows.length} transactions`;
}

function needsText(ev: Ev): string {
  const parts: string[] = [];
  if (ev.analysis.gaps.length) parts.push(`Missing: ${ev.analysis.gaps.slice(0, 4).map((g) => g.label).join(', ')}${ev.analysis.gaps.length > 4 ? ` and ${ev.analysis.gaps.length - 4} more` : ''}.`);
  if (ev.analysis.problems.length) parts.push(`${ev.analysis.problems.length} ${ev.analysis.problems.length === 1 ? 'number does' : 'numbers do'} not add up.`);
  if (ev.waitingFor) parts.push(`Waiting for ${ev.waitingFor} to be saved first: this is another document for the same purchase.`);
  if (ev.cashClash.length) parts.push('A charge with this amount already exists. Link it, or confirm this is a separate cash purchase.');
  if (ev.linkPending) parts.push('Choose which charge it belongs to.');
  if (ev.cash && !ev.cashCat) parts.push('Pick a category.');
  return parts.join(' ');
}

/** A file that has been read, as one row. Ready ones can be saved from here; the rest open to be answered. */
function Summary({ item, ev, accounts, onOpen, onSave, onRemove }: { item: Item; ev: Ev; accounts: Account[]; onOpen: () => void; onSave: () => void; onRemove: () => void }) {
  return (
    <Card title={item.file?.name ?? 'Receipt typed by hand'} right={<T size={12} tone={ev.canSave ? 'good' : 'ink3'} bold>{ev.canSave ? 'Ready' : 'Needs attention'}</T>}>
      <T size={13} tone="ink2">{summaryLine(item, statementAccounts(item, accounts))}</T>
      {item.receipt && ev.canSave ? <T size={12} tone="ink3">{ev.extra ? `Another document for ${ev.same!.of.label}. Adds no new purchase.` : ev.linkTxn ? (ev.second ? `Extra document for the ${ev.linkTxn.date} charge at ${ev.linkTxn.merchant}.` : `Matches ${ev.linkTxn.merchant}, ${ev.linkTxn.date}, ${dollars(-ev.linkTxn.cents)}.`) : ev.cash ? 'Will be added as a cash purchase.' : 'No matching charge yet. Kept as evidence.'}</T> : null}
      {!ev.canSave ? <T size={12} tone="bad">{needsText(ev)}</T> : null}
      {item.message ? <T size={12} tone="bad">{item.message}</T> : null}
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        {ev.canSave ? <Button small label="Save" onPress={onSave} /> : <Button small label="Answer questions" onPress={onOpen} />}
        <Button small kind="ghost" label="Review" onPress={onOpen} />
        <Button small kind="ghost" label="Discard" onPress={onRemove} />
      </View>
    </Card>
  );
}

function ItemCard({ item, ev, accounts, onAnswer, onSkip, onAcknowledge, onStatement, onSet, onSave, onCollapse, onRetryByHand, onRemove, onReread, onToggleAsk, onUseReading, onKeepReading, onRetryReceipt, onUseReceipt, onKeepReceipt, readers }: {
  item: Item; ev?: Ev; accounts: Account[]; onAnswer: (field: string, id: string, text: string) => void; onSkip: (g: Gap) => void; onAcknowledge: (id: string) => void;
  onStatement: (d: StatementDraft) => void; onSet: (over: Partial<Item>) => void; onSave: () => void; onCollapse?: () => void; onRetryByHand: () => void; onRemove: () => void;
  readers: string[];
  onReread: (text: string, model?: string) => void; onToggleAsk: () => void; onUseReading: () => void; onKeepReading: () => void;
  onRetryReceipt: (model?: string, hint?: string) => void; onUseReceipt: () => void; onKeepReceipt: () => void;
}) {
  const title = item.file?.name ?? 'Receipt typed by hand';
  const tag = item.kind === 'statement' ? 'Statement' : 'Receipt';
  if (item.status === 'queued') return <Card title={title} right={<T size={12} tone="ink3">Waiting</T>}><T size={13} tone="ink2">In line to be read.</T><View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Discard" onPress={onRemove} /></View></Card>;
  if (item.status === 'reading') return <Card title={title} right={<T size={12} tone="ink3">Reading</T>}><T size={13} tone="ink2">{item.message ?? `Reading the ${tag.toLowerCase()} and checking it. This can take a minute for a long statement.`}</T></Card>;
  if (item.status === 'duplicate') return <Card title={title}><T size={13} tone="ink2">{item.message}</T><View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Dismiss" onPress={onRemove} /></View></Card>;
  if (item.status === 'failed') return (
    <Card title={title}>
      <Banner title="Could not read this file">{item.message}</Banner>
      <T size={13} tone="ink2">You can still add it: the file is kept as the original, and you type the details it should have.</T>
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}><Button small label="Enter the details by hand" onPress={onRetryByHand} /><Button small kind="ghost" label="Discard" onPress={onRemove} /></View>
    </Card>
  );
  if (item.status === 'saved') return <Card title={title} right={<T size={12} tone="good" bold>Saved</T>}><T size={13} tone="ink2">{item.message}</T></Card>;
  if (!ev) return null;

  const saving = item.status === 'saving';
  const rec = item.receipt; const st = item.statement;
  const acct = st ? resolveAccount(st, statementAccounts(item, accounts)) : null;
  const sameAccountOptions = st && !acct ? accounts.filter((a) => sameBank(a, st.institution)) : [];
  const net = st ? st.rows.reduce((s, r) => s + (r.cents ?? 0), 0) : 0;
  return (
    <Card title={title} right={<T size={12} tone={ev.canSave ? 'good' : 'ink3'} bold>{ev.canSave ? 'Ready' : 'Needs attention'}</T>}>
      {rec ? (
        <>
          <Row label="Store" value={rec.merchant || 'missing'} /><Row label="Date" value={rec.date ?? 'missing'} />
          {rec.readBy ? <Row label="Read by" value={rec.readBy} /> : null}
          <Row label="Total paid" value={rec.totalCents != null ? dollars(rec.totalCents) : 'missing'} /><Row label="Items read" value={receiptUnits(rec.lines) !== rec.lines.length ? `${itemLines(rec.lines).length} lines, ${receiptUnits(rec.lines)} items${rec.lines.length !== itemLines(rec.lines).length ? `, ${rec.lines.length - itemLines(rec.lines).length} discount` : ''}${rec.itemCount ? ` (receipt prints ${rec.itemCount})` : ''}` : String(rec.lines.length)} />
          {rec.lines.length ? <TagNote lines={rec.lines} /> : null}
          {rec.charges?.length ? <Row label="Extra charges" value={`${dollars(rec.charges.reduce((t, x) => t + x.cents, 0))}: ${rec.charges.map((x) => `${x.label} ${dollars(x.cents)}`).join(', ')}`} /> : null}
          {rec.paidOtherCents ? <Row label="Paid with points or credit" value={dollars(rec.paidOtherCents)} /> : null}
          {rec.refundCents ? <Row label="Refunded" value={dollars(rec.refundCents)} /> : null}
          {rec.paymentMethod ? <Row label="Paid with" value={`${rec.paymentMethod}${rec.cardLast4 ? ` ending ${rec.cardLast4}` : ''}`} /> : null}
        </>
      ) : null}
      {st ? (
        <>
          <Row label="Account" value={acct ? acct.name : st.institution && st.last4 ? `New: ${st.institution} ${st.last4}` : 'unknown'} />
          {st.readBy ? <Row label="Read by" value={st.readBy} /> : null}
          {item.mergeInto && acct ? <T size={12} tone="ink3">Number {st.last4} will be added to {acct.name}, so its statements stay in one account.</T> : null}
          {sameAccountOptions.length ? (
            <View style={{ gap: 2 }}>
              <T size={12} tone="ink3">Is {st.last4} a new number for an account you already have (a reissued card, a changed account number)?</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                <Chip label="A new account" on={!item.mergeInto} onPress={() => onSet({ mergeInto: undefined })} />
                {sameAccountOptions.map((a) => <Chip key={a.id} label={`Same as ${a.name}`} on={item.mergeInto === a.id} onPress={() => onSet({ mergeInto: a.id })} />)}
              </View>
            </View>
          ) : null}
          <Row label="Period" value={st.periodFrom && st.periodTo ? `${st.periodFrom} to ${st.periodTo}` : 'missing'} />
          <Row label={st.accountType === 'credit' ? 'Previous / new balance' : 'Opening / closing'} value={st.openingCents != null && st.closingCents != null ? `${dollars(st.openingCents)} / ${dollars(st.closingCents)}` : 'missing'} />
          <Row label="Transactions read" value={`${st.rows.length}, net ${dollars(net)}`} />
        </>
      ) : null}

      <Findings analysis={ev.analysis} errors={item.errors}
        onAnswer={(g, text) => onAnswer(g.field, g.id, text)} onSkip={onSkip} onAcknowledge={onAcknowledge} />

      {rec && item.file && item.file.bytes.length > 0 ? (
        <ReceiptAgainBox busy={!!item.again?.busy} error={item.again?.error} proposal={item.again?.proposal} used={item.again?.tries ?? 0} max={MAX_REREADS} models={readers}
          onRetry={onRetryReceipt} onUse={onUseReceipt} onKeep={onKeepReceipt} />
      ) : null}

      {st && item.file && !ev.canSave && item.file.bytes.length > 0 ? (
        <RereadBox open={!!item.ask?.open} busy={!!item.ask?.busy} error={item.ask?.error} proposal={item.ask?.proposal} used={item.ask?.tries ?? 0} max={MAX_REREADS} models={readers}
          onToggle={onToggleAsk} onSend={onReread} onUse={onUseReading} onKeep={onKeepReading} />
      ) : null}

      {rec?.refundCents && ev.refundCredits.length ? <T size={13} tone="ink2">A credit that may be this refund is already in your ledger: {ev.refundCredits.slice(0, 3).map((c) => `${c.merchant}, ${c.date}, ${dollars(c.cents)}`).join('; ')}. It is only a hint. Nothing is linked.</T> : null}

      {rec && ev.extra && ev.same ? (
        <View style={{ gap: S.xs }}>
          <T size={13} tone="ink2">Treated as another document for {ev.same.of.label}{ev.same.of.date ? `, ${ev.same.of.date}` : ''} ({ev.same.why}). It is kept as evidence only: no new purchase, and the items are not split twice.</T>
          {ev.waitingFor ? <T size={13} tone="bad">Waiting for {ev.waitingFor} to be saved first.</T> : null}
          <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="This is a different purchase" onPress={() => onAnswer('dup', 'edit.dup', 'different')} /></View>
        </View>
      ) : null}
      {rec && !ev.extra && ev.cashClash.length ? (
        <View style={{ gap: S.xs }}>
          <Banner title="This amount is already in your ledger">{ev.cashClash.slice(0, 3).map((c) => `${c.merchant}, ${c.date}, ${dollars(-c.cents)}${c.accountId === 'cash' ? ' (earlier cash entry)' : ''}`).join('. ')}. Adding it as cash would count the purchase twice.</Banner>
          {ev.cashClash.slice(0, 3).map((c) => <Button key={c.id} small kind="outline" label={`It is this one: link to ${c.merchant}, ${c.date}`} onPress={() => onSet({ link: c.id })} />)}
          <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="It is a separate cash purchase" onPress={onAcknowledge.bind(null, 'cash-dup')} /></View>
        </View>
      ) : null}
      {rec && !ev.extra && ev.linkPending && item.link === 'auto' ? (
        <View style={{ gap: S.xs }}>
          <Banner title={ev.candidates.length > 1 ? 'More than one charge could be this receipt' : ev.likelyWhy ? 'This looks like the charge below' : 'A charge has this amount, but another store name'}>{ev.candidates.length > 1 ? 'Choose the right one, or keep the receipt unlinked.' : ev.likelyWhy ? `${ev.likelyWhy.charAt(0).toUpperCase()}${ev.likelyWhy.slice(1)}. The store name on the bank side differs. Confirm it if it is the same purchase; after ${AUTO_AFTER} confirmations on this card, matches like this are linked without asking.` : 'Link it if it is the same purchase, or keep the receipt unlinked.'}</Banner>
          {ev.candidates.map((c) => <Button key={c.id} small kind="outline" label={`${c.merchant}, ${c.date}, ${dollars(-c.cents)}${c.receiptId ? ' (has a receipt)' : ''}`} onPress={() => onSet({ link: c.id })} />)}
          <Button small kind="ghost" label="Keep it unlinked for now" onPress={() => onSet({ link: 'none' })} />
          <Button small kind="ghost" label="Paid another way (no charge expected)" onPress={() => onSet({ link: 'flag', noLink: 'cash' })} />
        </View>
      ) : null}
      {rec && !ev.extra && ev.analysis.ok && ev.linkTxn ? <T size={13} tone="ink2">{ev.second ? `Belongs to ${ev.linkTxn.merchant}, ${ev.linkTxn.date}, ${dollars(-ev.linkTxn.cents)}, which already has a receipt. This one is kept as an additional document and its items are not split again.` : `Links to ${ev.linkTxn.merchant}, ${ev.linkTxn.date}, ${dollars(-ev.linkTxn.cents)}${ev.matchWhy ? ` (matched on ${ev.matchWhy})` : ''}. Its items will be split out.`}</T> : null}
      {rec && !ev.extra && ev.analysis.ok && ev.linkTxn && item.link === 'auto' && !ev.second ? <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Not this charge: keep it unlinked" onPress={() => onSet({ link: 'none' })} /></View> : null}
      {rec && !ev.extra && ev.analysis.ok && !ev.linkTxn && !ev.linkPending && !ev.cashClash.length ? (
        <View style={{ gap: S.xs }}>
          <T size={13} tone="ink2">{ev.cash ? 'Will be added as a cash purchase. Pick its category.' : item.link === 'flag' ? 'Saved as paid another way: no charge is expected, and it will not be listed as unlinked.' : 'No charge in your ledger matches this receipt, so it is flagged as not linked. If its statement is not imported yet it will be linked when it is. If you paid cash, add it as a cash purchase; if it was paid some other way, say so.'}</T>
          <View style={{ flexDirection: 'row', gap: S.xs, flexWrap: 'wrap' }}>
            <Chip label="Keep as evidence, link later" on={!ev.cash && item.link !== 'flag'} onPress={() => onSet({ link: 'none' })} />
            <Chip label="Cash purchase (add to ledger)" on={ev.cash} onPress={() => onSet({ link: 'cash' })} />
            <Chip label="Paid another way (no charge expected)" on={item.link === 'flag'} onPress={() => onSet({ link: 'flag', noLink: item.noLink ?? 'cash' })} />
          </View>
          {item.link === 'flag' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{RECEIPT_NO_LINK.map((r) => <Chip key={r} label={NO_LINK_LABEL[r]} on={(item.noLink ?? 'cash') === r} onPress={() => onSet({ noLink: r })} />)}</View> : null}
          {ev.cash ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{allCategories().filter((c) => c.id !== 'uncategorized').map((c) => <Chip key={c.id} label={c.label} on={ev.cashCat === c.id} onPress={() => onSet({ cat: c.id })} />)}</View> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button label={saving ? 'Saving' : 'Save'} disabled={!ev.canSave || saving} onPress={onSave} />
        <Button small kind="ghost" label={item.edit ? 'Hide details' : 'Check or edit details'} onPress={() => onSet({ edit: !item.edit })} />
        {item.file && item.file.bytes.length > 0 ? <Button small kind="outline" label={item.peek ? 'Hide original' : 'Show original'} onPress={() => onSet({ peek: !item.peek })} /> : null}
        {onCollapse ? <Button small kind="ghost" label="Collapse" onPress={onCollapse} /> : null}
        <Button small kind="ghost" label="Discard" disabled={saving} onPress={onRemove} />
      </View>
      {!ev.canSave && !saving ? <T size={12} tone="ink3">Save unlocks when every question above is answered and every difference is fixed or confirmed.</T> : null}
      {item.message ? <T size={13} tone="bad">{item.message}</T> : null}

      {item.edit ? (
        <View style={{ gap: S.sm, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          {rec ? (
            <>
              {RECEIPT_FIELDS.map(([f, label]) => <FieldInput key={`${f}:${receiptFieldText(rec, f)}`} label={label} value={receiptFieldText(rec, f)} error={item.errors[`edit.${f}`]} onCommit={(t) => onAnswer(f, `edit.${f}`, t)} />)}
              <FieldInput key={`charges:${receiptFieldText(rec, 'charges')}`} label="Extra charges (service, delivery, fees), one per line as “label amount”" multiline value={receiptFieldText(rec, 'charges')} error={item.errors['edit.charges']} onCommit={(t) => onAnswer('charges', 'edit.charges', t)} />
              <FieldInput key={`lines:${receiptFieldText(rec, 'lines')}`} label="Items, one per line as “item price”" multiline value={receiptFieldText(rec, 'lines')} error={item.errors['edit.lines']} onCommit={(t) => onAnswer('lines', 'edit.lines', t)} />
            </>
          ) : null}
          {st ? (
            <>
              {STATEMENT_FIELDS.map(([f, label]) => <FieldInput key={`${f}:${statementFieldText(st, f)}`} label={label} value={statementFieldText(st, f)} error={item.errors[`edit.${f}`]} onCommit={(t) => onAnswer(f, `edit.${f}`, t)} />)}
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <Chip label="Checking or savings" on={st.accountType === 'checking'} onPress={() => onAnswer('accountType', 'edit.accountType', 'checking')} />
                <Chip label="Credit card" on={st.accountType === 'credit'} onPress={() => onAnswer('accountType', 'edit.accountType', 'credit')} />
              </View>
              <RowsEditor draft={st} onChange={onStatement} />
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
