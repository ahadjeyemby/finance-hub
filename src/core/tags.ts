// Tags: the cross-cutting view of spending. A transaction (and each item on it) has ONE category, which keeps totals additive, and any number of tags,
// which can overlap and are never added together with category totals. "Health" or "Work" is a tag: a pharmacy item at a big-box store is Household
// in one view and Health in another, and nothing is counted twice. Pure TypeScript: no React, no network, no model.
//
// Tags are found automatically from the words (merchant and bank description for a charge, the item text for an item), from the category, and from
// the Business switch. The person can add a tag or take one away on a charge or on a single item; those changes are kept and win over the rules.
import { categoryGroup, resolveCategory } from './categories';
import type { Txn } from './types';

export interface TagDef {
  id: string;
  label: string;
  /** words that give the tag: found in a merchant, a bank description or an item. Short ones (4 letters or fewer) must stand alone as a word. */
  keywords: string[];
  /** a charge or item in one of these categories carries the tag */
  categories?: string[];
  /** a charge marked Business carries the tag */
  business?: boolean;
  /** false = the rules are off, the tag is only ever added by hand */
  auto: boolean;
}

/** What the person changed by hand, on a charge (key `t:<id>`) or on one item of it (key `i:<id>:...`). */
export interface TagEdit { add?: string[]; remove?: string[]; /** items only: a different category for this item */ category?: string }
export interface TagState { defs: TagDef[]; edits: Record<string, TagEdit> }

export const DEFAULT_TAGS: TagDef[] = [
  { id: 'health', label: 'Health', auto: true, categories: ['medical'], keywords: [
    'pharmacy', 'cvs', 'walgreens', 'rite aid', 'clinic', 'doctor', 'dental', 'dentist', 'orthodont', 'hospital', 'urgent care', 'medical', 'labcorp', 'quest diagnostics',
    'optical', 'optometr', 'vision', 'eyecare', 'prescription', 'rx', 'ibuprofen', 'tylenol', 'acetaminophen', 'advil', 'motrin', 'aspirin', 'bandage', 'band-aid', 'thermometer',
    'antacid', 'allergy', 'cough', 'first aid', 'insulin', 'vitamin', 'copay', 'health'] },
  { id: 'household', label: 'Household', auto: true, categories: ['household'], keywords: [
    'detergent', 'laundry', 'dish soap', 'dishwasher', 'paper towel', 'toilet paper', 'tissue', 'trash bag', 'garbage bag', 'cleaner', 'bleach', 'sponge', 'light bulb', 'batteries',
    'battery', 'aluminum foil', 'plastic wrap', 'ziploc', 'mop', 'broom', 'air filter', 'hardware', 'home depot', 'lowes', 'ace hardware'] },
  { id: 'work', label: 'Work', auto: true, business: true, keywords: [
    'github', 'heroku', 'namecheap', 'aws', 'amazon web services', 'digitalocean', 'cloudflare', 'vercel', 'netlify', 'linkedin', 'zoom', 'slack', 'notion', 'openai', 'anthropic',
    'office depot', 'staples', 'hosting', 'domain'] },
  { id: 'kids', label: 'Kids', auto: true, categories: ['education'], keywords: ['daycare', 'school', 'tuition', 'diaper', 'baby', 'toys', 'kids', 'children', 'formula'] },
];

const SPEND = new Set(['spend', 'fee', 'refund']);
const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Does this text contain the word? Short words must stand alone ("rx", "aws"); longer ones may sit inside a bank's truncated text ("PHARMA", "WALGREENS #12"). */
export function hasWord(text: string, word: string): boolean {
  const w = norm(word).trim();
  if (!w) return false;
  const t = norm(text);
  return w.length <= 4 ? t.includes(` ${w} `) : t.includes(w);
}

/** The tags the rules give to a piece of text, a category and a Business mark. Tags whose rules are off give nothing. */
export function autoTagsFor(text: string, category: string | undefined, business: boolean | undefined, defs: TagDef[]): string[] {
  const cat = resolveCategory(category);
  return defs.filter((d) => d.auto && ((d.business && business) || (cat && d.categories?.includes(cat)) || d.keywords.some((k) => hasWord(text, k)))).map((d) => d.id);
}

export const txnKey = (id: string) => `t:${id}`;
/** An item is told apart by its charge, its words and its price; the nth of identical lines (three Green Onions at 0.89) gets its own number. */
export const itemKey = (txnId: string, item: string, cents: number, nth = 0) => `i:${txnId}:${cents}:${slug(item)}:${nth}`;
/** The charge a tag change belongs to, from either kind of key (the same rule as tag_edit_txn_id in migration 0009). */
export const tagEditTxnId = (key: string): string | null => (key.startsWith('t:') ? key.slice(2) : /^i:(.*):-?[0-9]+:[^:]*:[0-9]+$/.exec(key)?.[1] ?? null);

const set = (xs?: string[]) => new Set(xs ?? []);

/** The key of each item on a charge, in order, with identical lines numbered, exactly as applyTags reads them. */
export function lineKeys(txnId: string, lines: { item: string; cents: number }[] = []): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => { const k0 = itemKey(txnId, l.item, l.cents); const nth = seen.get(k0) ?? 0; seen.set(k0, nth + 1); return itemKey(txnId, l.item, l.cents, nth); });
}

/**
 * The transactions with their tags worked out. A charge carries the tags from its own words and category, plus the ones added by hand, minus the ones
 * taken away. Each item on it carries what the charge carries, plus what its own words give, plus and minus the person's changes to that item. Only
 * spending is tagged. Nothing is stored on the transactions: this is derived every time from the rules and the person's changes.
 */
export function applyTags(txns: Txn[], state?: TagState): Txn[] {
  const defs = state?.defs?.length ? state.defs : DEFAULT_TAGS;
  const edits = state?.edits ?? {};
  return txns.map((t0) => {
    // a category folded into another counts as the other one everywhere
    const merged = resolveCategory(t0.category);
    const t = merged && merged !== t0.category ? { ...t0, category: merged, ...(t0.lines ? { lines: t0.lines.map((l) => ({ ...l, ...(l.category ? { category: resolveCategory(l.category) ?? l.category } : {}) })) } : {}) } : t0;
    if (!SPEND.has(t.kind)) return t;
    const e = edits[txnKey(t.id)] ?? {};
    const rm = set(e.remove);
    const base = autoTagsFor(`${t.merchant} ${t.description}`, t.category, t.business, defs);
    const own = [...new Set([...base, ...(e.add ?? [])])].filter((x) => !rm.has(x));
    const keys = lineKeys(t.id, t.lines);
    const lines = t.lines?.map((l, i) => {
      const le = edits[keys[i]] ?? {};
      const category = le.category ?? l.category;
      // what the item inherits from its charge, what its own words and category give, then the person's changes to the item
      const lineBase = [...new Set([...own, ...autoTagsFor(l.item, category, undefined, defs)])];
      const lrm = set(le.remove);
      const tags = [...new Set([...lineBase, ...(le.add ?? [])])].filter((x) => !lrm.has(x));
      return { ...l, ...(category ? { category } : {}), tags, autoTags: lineBase };
    });
    const all = [...new Set([...own, ...(lines?.flatMap((l) => l.tags ?? []) ?? [])])];
    return { ...t, tags: all, autoTags: base, ...(lines ? { lines } : {}) };
  });
}

/** How much of a charge belongs to a tag, as spending (positive; a refund is negative). A charge with items counts only the items carrying the tag. */
export function tagCents(t: Txn, tagId: string): number {
  if (!t.tags?.includes(tagId)) return 0;
  const spend = -t.cents;
  if (!t.lines?.length) return spend;
  const total = t.lines.reduce((s, l) => s + l.cents, 0);
  if (total <= 0) return spend;
  const tagged = t.lines.filter((l) => l.tags?.includes(tagId)).reduce((s, l) => s + l.cents, 0);
  return tagged >= total ? spend : Math.round((spend * tagged) / total);
}

export interface TagTotal { tag: string; cents: number; count: number; stores: { merchant: string; cents: number }[] }

/** What each tag adds up to over the given charges. Overlapping on purpose: one item can count in several tags, so these are never summed together. */
export function tagTotals(txns: Txn[], defs: TagDef[] = DEFAULT_TAGS): TagTotal[] {
  return defs.map((d) => {
    const stores = new Map<string, number>(); let cents = 0; let count = 0;
    for (const t of txns) {
      const c = tagCents(t, d.id);
      if (!c && !t.tags?.includes(d.id)) continue;
      cents += c; count++; stores.set(t.merchant, (stores.get(t.merchant) ?? 0) + c);
    }
    return { tag: d.id, cents, count, stores: [...stores.entries()].map(([merchant, c]) => ({ merchant, cents: c })).sort((a, b) => b.cents - a.cents).slice(0, 5) };
  });
}

// ---------------------------------------------------------------------------
// Changes the person makes
// ---------------------------------------------------------------------------

/** Put a tag on, or take it off, a charge or an item. A tag the rules gave is taken off by recording the removal; one added by hand is taken off by forgetting it. */
export function setTag(state: TagState | undefined, key: string, tagId: string, on: boolean, autoHas: boolean): TagState {
  const defs = state?.defs?.length ? state.defs : DEFAULT_TAGS;
  const cur = { ...(state?.edits[key] ?? {}) };
  const add = new Set(cur.add); const remove = new Set(cur.remove);
  if (on) { remove.delete(tagId); if (!autoHas) add.add(tagId); }
  else { add.delete(tagId); if (autoHas) remove.add(tagId); }
  const next: TagEdit = { ...cur, add: [...add], remove: [...remove] };
  if (!next.add!.length) delete next.add;
  if (!next.remove!.length) delete next.remove;
  const edits = { ...(state?.edits ?? {}) };
  if (Object.keys(next).length) edits[key] = next; else delete edits[key];
  return { defs, edits };
}

/** Give an item a different category than the one it has (or take the change away with undefined). */
export function setItemCategory(state: TagState | undefined, key: string, category: string | undefined): TagState {
  const defs = state?.defs?.length ? state.defs : DEFAULT_TAGS;
  const next: TagEdit = { ...(state?.edits[key] ?? {}) };
  if (category) next.category = category; else delete next.category;
  const edits = { ...(state?.edits ?? {}) };
  if (Object.keys(next).length) edits[key] = next; else delete edits[key];
  return { defs, edits };
}

/** A new tag, or changes to one. The id comes from the name for a new tag and never changes after. */
export function saveTag(state: TagState | undefined, tag: Partial<TagDef> & { label: string }): TagState {
  const defs = [...(state?.defs?.length ? state.defs : DEFAULT_TAGS)];
  const id = tag.id ?? (() => { const base = slug(tag.label) || 'tag'; let id = base; let n = 2; while (defs.some((d) => d.id === id)) id = `${base}_${n++}`; return id; })();
  const i = defs.findIndex((d) => d.id === id);
  const clean = (tag.keywords ?? (i >= 0 ? defs[i].keywords : [])).map((k) => k.trim()).filter(Boolean);
  const def: TagDef = { id, label: tag.label.trim(), keywords: [...new Set(clean)], auto: tag.auto ?? (i >= 0 ? defs[i].auto : true), ...(tag.categories ?? (i >= 0 ? defs[i].categories : undefined) ? { categories: tag.categories ?? defs[i].categories } : {}), ...((tag.business ?? (i >= 0 ? defs[i].business : undefined)) ? { business: true } : {}) };
  if (i >= 0) defs[i] = def; else defs.push(def);
  return { defs, edits: state?.edits ?? {} };
}

/** Remove a tag everywhere: its definition and every change the person made with it. */
export function deleteTag(state: TagState | undefined, tagId: string): TagState {
  const defs = (state?.defs?.length ? state.defs : DEFAULT_TAGS).filter((d) => d.id !== tagId);
  const edits: TagState['edits'] = {};
  for (const [k, e] of Object.entries(state?.edits ?? {})) {
    const next: TagEdit = { ...e, add: e.add?.filter((x) => x !== tagId), remove: e.remove?.filter((x) => x !== tagId) };
    if (!next.add?.length) delete next.add;
    if (!next.remove?.length) delete next.remove;
    if (Object.keys(next).length) edits[k] = next;
  }
  return { defs, edits };
}

/** How much spending falls in a group of categories (Need, Want or Mixed): by item where a charge has them, otherwise by the charge's own category. */
export function groupCents(txns: Txn[], group: 'need' | 'want' | 'mixed'): number {
  let sum = 0;
  for (const t of txns) {
    if (!SPEND.has(t.kind)) continue;
    const spend = -t.cents;
    if (!t.lines?.length) { if (categoryGroup(t.category) === group) sum += spend; continue; }
    const total = t.lines.reduce((s, l) => s + l.cents, 0);
    if (total <= 0) { if (categoryGroup(t.category) === group) sum += spend; continue; }
    const inGroup = t.lines.filter((l) => categoryGroup(l.category ?? t.category) === group).reduce((s, l) => s + l.cents, 0);
    sum += inGroup >= total ? spend : Math.round((spend * inGroup) / total);
  }
  return sum;
}
