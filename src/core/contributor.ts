// A Contributor (migration 0010) adds receipts and credit card statements to the owner's books and sees only the owner's spending. Pure
// TypeScript. The database decides what a Contributor can read and write; this file holds the app's side of the same rules:
//   * spendingView: the rows a Contributor sees, the same rule as owner_spending() in the migration. Used for the development preview and
//     tested against the database, so the two never drift apart.
//   * editsFromOverlay: the Contributor's own decisions, as the rows of contributor_edits the database accepts.
//   * layerContributorEdits: on the owner's side, those rows laid under the owner's own decisions, for display only.
//   * newCardPairs: card payments a Contributor added have no partner yet; the owner's app pairs them with the checking side.
import { pairTransfers } from './classify';
import type { TagEdit } from './tags';
import type { Kind, Overlay, Txn } from './types';

/** What a Contributor sees: spending, fees and refunds. */
export const SPENDING_KINDS: readonly Kind[] = ['spend', 'fee', 'refund'];
/** The hints that may reach a Contributor: none of them is about pay or transfers. */
export const SPENDING_HINTS: readonly string[] = ['needs_items', 'unknown_merchant', 'person_payment', 'business_or_personal', 'large_one_off'];

/** The fields a Contributor may change, per kind of edit (checked again by the database). */
export const EDIT_FIELDS = {
  t: ['category', 'subcategory', 'business', 'oneOff', 'note', 'lines', 'receiptId'],
  m: ['category', 'business'],
  g: ['add', 'remove', 'category'],
} as const;

export interface ContributorEdit { key: string; patch: Record<string, unknown> }
export interface StoredEdit extends ContributorEdit { contributor: string; updatedAt: string }

const pick = (o: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o && k in o && o[k] !== undefined) out[k] = o[k];
  return out;
};

/**
 * The owner's rows as a Contributor sees them: the owner's merchant rules and patches applied (as applyOverlay does), then only spending,
 * with income hints removed and pairing and subtypes dropped. Cash entries are included.
 */
export function spendingView(txns: Txn[], overlay: Overlay): Txn[] {
  const out: Txn[] = [];
  for (const t of [...txns, ...overlay.manual]) {
    const rule = overlay.merchantRules[t.merchant];
    const patch = overlay.patches[t.id];
    const s: Txn = rule || patch ? { ...t, ...(t.kind === 'spend' || t.kind === 'refund' ? rule : {}), ...patch } : { ...t };
    if (!SPENDING_KINDS.includes(s.kind)) continue;
    delete s.subtype; delete s.pairId;
    const hints = (s.hints ?? []).filter((h) => SPENDING_HINTS.includes(h));
    if (hints.length) s.hints = hints; else delete s.hints;
    out.push(s);
  }
  return out;
}

/** The Contributor's decisions in the form contributor_edits stores: one row per charge, merchant rule and tag change, allowed fields only. */
export function editsFromOverlay(o: Overlay): ContributorEdit[] {
  const out: ContributorEdit[] = [];
  for (const [id, p] of Object.entries(o.patches)) {
    const patch = pick(p as Record<string, unknown>, EDIT_FIELDS.t);
    if (Object.keys(patch).length) out.push({ key: `t:${id}`, patch });
  }
  for (const [merchant, r] of Object.entries(o.merchantRules)) {
    const patch = pick(r as Record<string, unknown>, EDIT_FIELDS.m);
    if (Object.keys(patch).length) out.push({ key: `m:${merchant}`, patch });
  }
  for (const [k, e] of Object.entries(o.tags?.edits ?? {})) {
    const patch = pick(e as Record<string, unknown>, EDIT_FIELDS.g);
    if (Object.keys(patch).length) out.push({ key: `g:${k}`, patch });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What to send so the stored rows match the decisions: rows that are new or changed, and keys that are gone. */
export function diffEdits(desired: ContributorEdit[], stored: ContributorEdit[]): { upsert: ContributorEdit[]; remove: string[] } {
  const have = new Map(stored.map((e) => [e.key, e.patch]));
  const want = new Set(desired.map((e) => e.key));
  return { upsert: desired.filter((e) => !have.has(e.key) || !same(have.get(e.key), e.patch)), remove: stored.filter((e) => !want.has(e.key)).map((e) => e.key) };
}

/** The stored rows back into overlay form, so a Contributor's device starts from what it saved last time. */
export function overlayFromEdits(edits: ContributorEdit[]): Pick<Overlay, 'patches' | 'merchantRules'> & { tagEdits: Record<string, TagEdit> } {
  const patches: Overlay['patches'] = {}; const merchantRules: Overlay['merchantRules'] = {}; const tagEdits: Record<string, TagEdit> = {};
  for (const e of edits) {
    const rest = e.key.slice(2);
    if (e.key.startsWith('t:')) patches[rest] = { ...patches[rest], ...(e.patch as Overlay['patches'][string]) };
    else if (e.key.startsWith('m:')) merchantRules[rest] = { ...merchantRules[rest], ...(e.patch as Overlay['merchantRules'][string]) };
    else if (e.key.startsWith('g:')) tagEdits[rest] = { ...tagEdits[rest], ...(e.patch as TagEdit) };
  }
  return { patches, merchantRules, tagEdits };
}

/**
 * The owner's view: what Contributors changed, laid under the owner's own decisions. The newest Contributor edit wins among Contributors and
 * the owner's own patch, rule or tag change always wins over all of them. For display only: nothing of this is saved into the owner's overlay.
 */
export function layerContributorEdits(own: Overlay, edits: StoredEdit[]): Overlay {
  if (!edits.length) return own;
  const theirs = overlayFromEdits([...edits].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)));
  const patches: Overlay['patches'] = { ...theirs.patches };
  for (const [id, p] of Object.entries(own.patches)) patches[id] = { ...patches[id], ...p };
  const tagEdits: Record<string, TagEdit> = { ...theirs.tagEdits };
  for (const [k, e] of Object.entries(own.tags?.edits ?? {})) tagEdits[k] = { ...tagEdits[k], ...e };
  return {
    ...own, patches, merchantRules: { ...theirs.merchantRules, ...own.merchantRules },
    ...(own.tags || Object.keys(tagEdits).length ? { tags: { defs: own.tags?.defs ?? [], edits: tagEdits } } : {}),
  };
}

/**
 * Card payments that have no partner yet (a Contributor adds them without one, since the checking side is hidden from them), paired with an
 * unpaired payment out of checking. Rows already paired are never touched. Returns both sides of each new pair.
 */
export function newCardPairs(txns: Txn[]): { id: string; pairId: string }[] {
  const loose = txns.filter((t) => t.kind === 'transfer' && t.subtype === 'card_payment' && !t.pairId && !t.manual).map((t) => ({ ...t }));
  pairTransfers(loose);
  return loose.filter((t) => t.pairId).map((t) => ({ id: t.id, pairId: t.pairId! }));
}
