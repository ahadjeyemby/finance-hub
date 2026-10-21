// Putting a team's data side by side. An admin can read what their members hold (migration 0006); this turns "my data plus each member's data" into
// one set of accounts and charges that the rest of the app can use unchanged, with every row remembering whose it is.
//
// The rules that keep it honest:
//   * Ids are only unique within one person ("t1", "acc" can exist for both), so a member's ids are prefixed with their user id. The admin's own
//     ids stay exactly as they are, so everything the admin saved before keeps working.
//   * A member's own decisions (their patches, rules and cash entries) are applied to their rows first, as they would see them. The admin's
//     decisions are applied afterwards over the whole set, so the admin's category or tag change wins in the admin's overall view and never touches
//     the member's own view.
//   * Pure TypeScript: nothing here reads or writes the database.
import { applyOverlay } from './queries';
import type { CategoryConfig } from './categories';
import type { IncomeState } from './income';
import type { Link, LinkFlag, StoredReceipt } from './links';
import type { TagState } from './tags';
import type { Account, Overlay, Txn } from './types';

export interface LinkBundle { links: Link[]; flags: LinkFlag[]; receipts: StoredReceipt[] }
export interface PersonData { id: string; accounts: Account[]; txns: Txn[]; overlay: Overlay; links: LinkBundle | null }

/** the cash pseudo-account is one shared name for cash entries, not an account of anyone's */
const CASH = 'cash';

export const nsId = (owner: string, id: string): string => `${owner}:${id}`;

/** Prefix a member's id with their user id. */
export const nsTxn = (owner: string, t: Txn): Txn => ({
  ...t, owner, id: nsId(owner, t.id), accountId: t.accountId === CASH ? CASH : nsId(owner, t.accountId), ...(t.pairId ? { pairId: nsId(owner, t.pairId) } : {}),
});
export const nsAccount = (owner: string, a: Account): Account => ({ ...a, owner, id: a.id === CASH ? CASH : nsId(owner, a.id) });

/** The key a tag edit is stored under, moved into a member's id space: t:<id> and i:<id>:<cents>:<slug>:<nth>. Anything else is returned as it is. */
export function nsTagKey(owner: string, key: string): string {
  if (key.startsWith('t:')) return `t:${nsId(owner, key.slice(2))}`;
  const m = /^i:(.*):(-?\d+):([^:]*):(\d+)$/.exec(key);
  return m ? `i:${nsId(owner, m[1])}:${m[2]}:${m[3]}:${m[4]}` : key;
}

/** The tag list is the admin's, plus any tag a member made that the admin does not have; edits are everyone's, with the admin's winning. */
export function mergeTagStates(own: TagState, members: { id: string; tags?: TagState }[]): TagState {
  const defs = [...own.defs];
  const edits: TagState['edits'] = {};
  for (const m of members) {
    for (const d of m.tags?.defs ?? []) if (!defs.some((x) => x.id === d.id)) defs.push(d);
    for (const [k, v] of Object.entries(m.tags?.edits ?? {})) edits[nsTagKey(m.id, k)] = v;
  }
  return { defs, edits: { ...edits, ...own.edits } };
}

/** Categories members made are added (so their charges keep a name); renames, hiding and merging stay the admin's. */
export function mergeCategoryConfigs(own: CategoryConfig | undefined, members: (CategoryConfig | undefined)[]): CategoryConfig | undefined {
  const extra = members.flatMap((c) => c?.custom ?? []).filter((c) => !(own?.custom ?? []).some((x) => x.id === c.id));
  if (!own && !extra.length) return undefined;
  const seen = new Set<string>();
  const custom = [...(own?.custom ?? []), ...extra].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return { custom, edits: own?.edits ?? {}, merged: own?.merged ?? {} };
}

/** Sources and pay records of everyone, so the income page can account for every deposit; a member's hand assignments are moved into their id space. */
export function mergeIncomes(own: IncomeState, members: { id: string; income?: IncomeState }[]): IncomeState {
  const byId = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()];
  const assign: IncomeState['assign'] = {};
  for (const m of members) for (const [txn, src] of Object.entries(m.income?.assign ?? {})) assign[nsId(m.id, txn)] = src;
  return {
    sources: byId([...own.sources, ...members.flatMap((m) => m.income?.sources ?? [])]),
    records: byId([...own.records, ...members.flatMap((m) => m.income?.records ?? [])]),
    assign: { ...assign, ...own.assign },
  };
}

function mergeLinks(own: LinkBundle | null, members: PersonData[]): LinkBundle | null {
  if (!own && !members.some((m) => m.links)) return null;
  const links = [...(own?.links ?? [])], flags = [...(own?.flags ?? [])], receipts = [...(own?.receipts ?? [])];
  const seen = new Set(receipts.map((r) => r.id));
  for (const m of members) {
    for (const l of m.links?.links ?? []) links.push({ ...l, txnId: nsId(m.id, l.txnId) });
    for (const f of m.links?.flags ?? []) flags.push(f.kind === 'txn' ? { ...f, refId: nsId(m.id, f.refId) } : f);
    for (const r of m.links?.receipts ?? []) if (!seen.has(r.id)) { seen.add(r.id); receipts.push(r); }
  }
  return { links, flags, receipts };
}

export interface Combined {
  accounts: Account[];
  /** the admin's own charges untouched, and each member's with their own decisions applied. The admin's overlay is applied over this. */
  txns: Txn[];
  links: LinkBundle | null;
  tags: TagState;
  categories: CategoryConfig | undefined;
  income: IncomeState;
}

export function combineTeam(own: PersonData & { tags: TagState; income: IncomeState }, members: PersonData[]): Combined {
  const accounts: Account[] = own.accounts.map((a) => ({ ...a, owner: own.id }));
  const txns: Txn[] = own.txns.map((t) => ({ ...t, owner: own.id }));
  const have = new Set(accounts.map((a) => a.id));
  for (const m of members) {
    for (const a of m.accounts.map((x) => nsAccount(m.id, x))) if (!have.has(a.id)) { have.add(a.id); accounts.push(a); }
    txns.push(...applyOverlay(m.txns, m.overlay).map((t) => nsTxn(m.id, t)));
  }
  return {
    accounts, txns, links: mergeLinks(own.links, members),
    tags: mergeTagStates(own.tags, members.map((m) => ({ id: m.id, tags: m.overlay.tags }))),
    categories: mergeCategoryConfigs(own.overlay.categories, members.map((m) => m.overlay.categories)),
    income: mergeIncomes(own.income, members.map((m) => ({ id: m.id, income: m.overlay.income }))),
  };
}

/** 'all', 'me' (the signed-in person), or a member's user id. */
export type Viewing = 'all' | 'me' | string;

/** Is a row in the current view? A row with no owner is the signed-in person's own. */
export const inView = (owner: string | undefined, viewing: Viewing, me: string): boolean => viewing === 'all' || (owner ?? me) === (viewing === 'me' ? me : viewing);

// ---------------------------------------------------------------------------
// Saving: only what is the admin's own goes back into the admin's overlay
// ---------------------------------------------------------------------------
// The screens edit the combined lists (their tags, categories and income sources next to the admin's). When the admin saves, copying the members'
// parts into the admin's own overlay would freeze them there: a later change by the member would be ignored, and removing something would not
// stick. So what came only from the members, and was not touched, is left out of what is saved.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `fromMembers` is what the members alone contributed (mergeTagStates with an empty admin state). */
export function ownTagState(next: TagState, fromMembers: TagState, before: TagState | undefined): TagState {
  const wasOwn = new Set((before?.defs ?? []).map((d) => d.id));
  const memberDefs = new Map(fromMembers.defs.map((d) => [d.id, d]));
  const defs = next.defs.filter((d) => wasOwn.has(d.id) || !memberDefs.has(d.id) || !same(memberDefs.get(d.id), d)).filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i);
  const edits: TagState['edits'] = {};
  for (const [k, v] of Object.entries(next.edits)) if (k in (before?.edits ?? {}) || !(k in fromMembers.edits) || !same(fromMembers.edits[k], v)) edits[k] = v;
  return { defs, edits };
}

/** `fromMembers` is the members' categories alone. */
export function ownCategoryConfig(next: CategoryConfig | undefined, fromMembers: CategoryConfig | undefined, before: CategoryConfig | undefined): CategoryConfig | undefined {
  if (!next) return next;
  const wasOwn = new Set((before?.custom ?? []).map((c) => c.id));
  const memberOnly = new Map((fromMembers?.custom ?? []).map((c) => [c.id, c]));
  return { ...next, custom: next.custom.filter((c) => wasOwn.has(c.id) || !memberOnly.has(c.id) || !same(memberOnly.get(c.id), c)) };
}

/** `fromMembers` is mergeIncomes with an empty admin state. */
export function ownIncomeState(next: IncomeState, fromMembers: IncomeState, before: IncomeState | undefined): IncomeState {
  const keep = <T extends { id: string }>(xs: T[], mem: T[], was: T[]) => xs.filter((x) => was.some((w) => w.id === x.id) || !mem.some((m) => m.id === x.id) || !same(mem.find((m) => m.id === x.id), x));
  const assign: IncomeState['assign'] = {};
  for (const [k, v] of Object.entries(next.assign)) if (k in (before?.assign ?? {}) || fromMembers.assign[k] !== v) assign[k] = v;
  return { sources: keep(next.sources, fromMembers.sources, before?.sources ?? []), records: keep(next.records, fromMembers.records, before?.records ?? []), assign };
}
