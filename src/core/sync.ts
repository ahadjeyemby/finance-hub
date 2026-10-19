import type { Account, Hint, Overlay, Txn } from './types';

// Pure mapping and merge logic for the Supabase sync. No network, no React.

export interface TxnRow {
  id: string; account_id: string; date: string; description: string; merchant: string; cents: number; kind: string;
  subtype: string | null; category: string | null; subcategory: string | null; business: boolean | null; one_off: boolean | null;
  pair_id: string | null; source: string; ref: string | null; note: string | null; hints: string[]; manual: boolean; receipt_id: string | null; lines: unknown | null;
}
export interface AccountRow { id: string; name: string; institution: string; type: string; last4: string; coverage_from: string; coverage_to: string; income_complete: boolean | null; extra_numbers?: unknown }

const n = <T,>(v: T | undefined | null): T | null => (v === undefined ? null : v);
const u = <T,>(v: T | null): T | undefined => (v === null ? undefined : v);

export const txnToRow = (t: Txn): TxnRow => ({
  id: t.id, account_id: t.accountId, date: t.date, description: t.description, merchant: t.merchant, cents: t.cents, kind: t.kind,
  subtype: n(t.subtype), category: n(t.category), subcategory: n(t.subcategory), business: n(t.business), one_off: n(t.oneOff),
  pair_id: n(t.pairId), source: t.source, ref: n(t.ref), note: n(t.note), hints: t.hints ?? [], manual: !!t.manual, receipt_id: n(t.receiptId), lines: n(t.lines),
});

export const rowToTxn = (r: TxnRow): Txn => {
  const t: Txn = { id: r.id, accountId: r.account_id, date: r.date, description: r.description, merchant: r.merchant, cents: r.cents, kind: r.kind as Txn['kind'], source: r.source };
  if (r.subtype !== null) t.subtype = r.subtype;
  if (r.category !== null) t.category = r.category as Txn['category'];
  if (r.subcategory !== null) t.subcategory = r.subcategory;
  if (r.business !== null) t.business = r.business;
  if (r.one_off !== null) t.oneOff = r.one_off;
  if (r.pair_id !== null) t.pairId = r.pair_id;
  if (r.ref !== null) t.ref = r.ref;
  if (r.note !== null) t.note = r.note;
  if (r.hints?.length) t.hints = r.hints as Hint[];
  if (r.manual) t.manual = true;
  if (r.receipt_id !== null) t.receiptId = r.receipt_id;
  if (r.lines) t.lines = r.lines as Txn['lines'];
  return t;
};

export const accountToRow = (a: Account): AccountRow => ({
  id: a.id, name: a.name, institution: a.institution, type: a.type, last4: a.last4,
  coverage_from: a.coverage.from, coverage_to: a.coverage.to, income_complete: n(a.incomeComplete),
  // only sent when there is something to say, so a database without migration 0004 still accepts the row
  ...(a.extraNumbers?.length ? { extra_numbers: a.extraNumbers } : {}),
});
export const rowToAccount = (r: AccountRow): Account => ({
  id: r.id, name: r.name, institution: r.institution, type: r.type as Account['type'], last4: r.last4,
  coverage: { from: r.coverage_from, to: r.coverage_to }, ...(r.income_complete !== null ? { incomeComplete: u(r.income_complete) } : {}),
  ...(Array.isArray(r.extra_numbers) && r.extra_numbers.length ? { extraNumbers: r.extra_numbers as Account['extraNumbers'] } : {}),
});

export const chunk = <T,>(xs: T[], size: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size)); return out; };

/**
 * Combine two overlays edited on different devices. Union by key; where both sides have the same key, `remote` wins.
 * Known limit: an Undo made offline on one device can be resurrected by a stale copy from the other.
 */
export function mergeOverlays(local: Overlay, remote: Overlay): Overlay {
  const manual = new Map(local.manual.map((t) => [t.id, t]));
  for (const t of remote.manual) manual.set(t.id, t);
  const reports = new Map(local.savedReports.map((r) => [r.id, r]));
  for (const r of remote.savedReports) reports.set(r.id, r);
  const patches: Overlay['patches'] = { ...local.patches };
  for (const [id, p] of Object.entries(remote.patches)) patches[id] = { ...patches[id], ...p };
  return {
    manual: [...manual.values()],
    patches,
    merchantRules: { ...local.merchantRules, ...remote.merchantRules },
    answered: { ...local.answered, ...remote.answered },
    savedReports: [...reports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/** Accept only a well-formed overlay from the network; anything else becomes an empty section. */
export function parseOverlay(body: unknown): Overlay {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, never>) : {});
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return { manual: arr(b.manual) as Txn[], patches: obj(b.patches), merchantRules: obj(b.merchantRules), answered: obj(b.answered) as Record<string, string>, savedReports: arr(b.savedReports) as Overlay['savedReports'] };
}

export const overlayIsEmpty = (o: Overlay) => !o.manual.length && !Object.keys(o.patches).length && !Object.keys(o.merchantRules).length && !Object.keys(o.answered).length && !o.savedReports.length;

/** Mark manual entries that have not reached the database yet. Called with the moment a push is attempted. */
export function stampUploads(o: Overlay, nowISO: string): Overlay {
  if (!o.manual.some((t) => !t.uploadedAt)) return o;
  return { ...o, manual: o.manual.map((t) => (t.uploadedAt ? t : { ...t, uploadedAt: nowISO })) };
}

/** After a successful push, copy the upload times onto the current overlay without touching anything edited meanwhile. */
export function adoptUploadStamps(current: Overlay, pushed: Overlay): Overlay {
  const at = new Map(pushed.manual.filter((t) => t.uploadedAt).map((t) => [t.id, t.uploadedAt!]));
  if (!current.manual.some((t) => !t.uploadedAt && at.has(t.id))) return current;
  return { ...current, manual: current.manual.map((t) => (!t.uploadedAt && at.has(t.id) ? { ...t, uploadedAt: at.get(t.id) } : t)) };
}

/** 'Oct 17, 2026, 8:47 AM' in the device's own time zone. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours() % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

// ---------------------------------------------------------------------------
// Where the ledger on screen came from. The app shows rows that Supabase returned for the signed-in person and nothing else.
// The device keeps a copy only so the app opens quickly and survives being offline. A copy is accepted only when it was
// downloaded from the same project by the same person; anything else is discarded and the screen says so.
// ---------------------------------------------------------------------------

export interface LedgerCopy { accounts: Account[]; txns: Txn[] }
export interface LedgerCache { v: 2; project: string; userId: string; at: string; ledger: LedgerCopy }
export type LedgerKind = 'none' | 'saved' | 'database';

/** 'abcd1234' from https://abcd1234.supabase.co, or null when the URL is missing or unreadable */
export const projectRefOf = (url?: string | null): string | null => {
  if (!url) return null;
  try { return new URL(url).hostname.split('.')[0] || null; } catch { return null; }
};

export const makeLedgerCache = (project: string, userId: string, at: string, ledger: LedgerCopy): LedgerCache => ({ v: 2, project, userId, at, ledger });

/** The saved copy, only if it was downloaded from this project for this person. Old, foreign or damaged copies give null. */
export function parseLedgerCache(raw: string | null, project: string | null, userId: string | null): LedgerCache | null {
  if (!raw || !project || !userId) return null;
  try {
    const c = JSON.parse(raw) as Partial<LedgerCache>;
    if (c.v !== 2 || c.project !== project || c.userId !== userId || typeof c.at !== 'string') return null;
    if (!c.ledger || !Array.isArray(c.ledger.accounts) || !Array.isArray(c.ledger.txns) || !c.ledger.accounts.length) return null;
    return c as LedgerCache;
  } catch { return null; }
}

export const ownerTag = (project: string | null, userId: string) => `${project ?? 'none'}:${userId}`;

/**
 * Whose data is on this device? 'same' and 'unknown' (written before this check existed) keep the person's unsent edits;
 * 'other' means a different project or person signed in here last, so nothing local may carry over.
 */
export const ownerVerdict = (stored: string | null, now: string): 'same' | 'unknown' | 'other' => (stored === null ? 'unknown' : stored === now ? 'same' : 'other');
