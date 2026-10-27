import type { Category, CategoryId } from './types';

export const CATEGORIES: Category[] = [
  { id: 'groceries', label: 'Groceries', group: 'need' },
  { id: 'household', label: 'Household & supplies', group: 'need' },
  { id: 'clothing', label: 'Clothing & shoes', group: 'mixed' },
  { id: 'fuel', label: 'Fuel', group: 'need' },
  { id: 'medical', label: 'Medical', group: 'need' },
  { id: 'auto', label: 'Car maintenance & registration', group: 'need' },
  { id: 'insurance', label: 'Insurance', group: 'need' },
  { id: 'housing', label: 'Rent & mortgage', group: 'need' },
  { id: 'utilities', label: 'Utilities', group: 'need' },
  { id: 'phone', label: 'Phone & internet', group: 'need' },
  { id: 'education', label: 'Education & kids', group: 'need' },
  { id: 'personal_care', label: 'Personal care', group: 'need' },
  { id: 'government', label: 'Government & fees', group: 'need' },
  { id: 'restaurants', label: 'Restaurants', group: 'want' },
  { id: 'entertainment', label: 'Entertainment', group: 'want' },
  { id: 'travel', label: 'Travel', group: 'want' },
  { id: 'subscriptions', label: 'Software & subscriptions', group: 'mixed' },
  { id: 'electronics', label: 'Electronics & gear', group: 'want' },
  { id: 'online_shopping', label: 'Online shopping (unsplit)', group: 'mixed' },
  { id: 'mixed_retail', label: 'Big-box stores (unsplit)', group: 'mixed' },
  { id: 'giving', label: 'Giving', group: 'mixed' },
  { id: 'people', label: 'Payments to people', group: 'mixed' },
  { id: 'other', label: 'Other', group: 'mixed' },
  { id: 'uncategorized', label: 'Needs a category', group: 'mixed' },
];

/**
 * The categories the person added, renamed, regrouped, hid or merged. Kept on the overlay (their saved decisions) and registered here when it loads,
 * so every screen that asks for a label or a group sees the same list without the overlay being passed around.
 */
export interface CategoryConfig {
  /** categories the person added (ids start with c_) */
  custom: Category[];
  /** changes to a built-in or added category */
  edits: Record<string, { label?: string; group?: Category['group']; hidden?: boolean }>;
  /** a category folded into another: everything in `from` now counts as `to` (nothing is changed on the transactions) */
  merged: Record<string, string>;
}
export const emptyCategoryConfig = (): CategoryConfig => ({ custom: [], edits: {}, merged: {} });
let config: CategoryConfig = emptyCategoryConfig();

/** Register the person's category changes. Call with nothing to go back to the built-in list. */
export function setCategoryConfig(c?: Partial<CategoryConfig> | null): void {
  config = { custom: c?.custom ?? [], edits: c?.edits ?? {}, merged: c?.merged ?? {} };
}
export const getCategoryConfig = (): CategoryConfig => config;

const builtIn = new Map(CATEGORIES.map((c) => [c.id as string, c]));
const effective = (c: Category): Category => ({ ...c, label: config.edits[c.id]?.label?.trim() || c.label, group: config.edits[c.id]?.group ?? c.group });
const lookup = (id: string): Category | undefined => { const c = builtIn.get(id) ?? config.custom.find((x) => x.id === id); return c ? effective(c) : undefined; };

/** Follow merges to the category something now counts as. */
export function resolveCategory(id?: string): string | undefined {
  let cur = id;
  for (let i = 0; i < 6 && cur && config.merged[cur]; i++) cur = config.merged[cur];
  return cur;
}

/** The list to show in pickers: built-in and added categories with the person's changes, without hidden or merged-away ones. */
export function allCategories(): Category[] {
  return [...CATEGORIES, ...config.custom].filter((c) => c.id === 'uncategorized' || (!config.edits[c.id]?.hidden && !config.merged[c.id])).map(effective);
}
/** Every category including hidden and merged-away ones, for the management screen. */
export const everyCategory = (): Category[] => [...CATEGORIES, ...config.custom].map(effective);

export const categoryLabel = (id?: CategoryId | string): string => (resolveCategory(id) && lookup(resolveCategory(id)!)?.label) || 'Needs a category';
export const categoryGroup = (id?: CategoryId): Category['group'] => (resolveCategory(id) && lookup(resolveCategory(id)!)?.group) || 'mixed';
export const isCategoryId = (s: string): s is CategoryId => !!lookup(s);

/** The six colour groups every chart uses (fixed per category, never reassigned): each category counts in exactly one. */
export type ColorGroup = 'travel' | 'bigbox' | 'groceries' | 'fuel' | 'medical' | 'other';
const COLOR_GROUP: Record<string, ColorGroup> = { travel: 'travel', mixed_retail: 'bigbox', groceries: 'groceries', fuel: 'fuel', medical: 'medical' };
export const colorGroupOf = (id?: CategoryId | string): ColorGroup => COLOR_GROUP[resolveCategory(id) ?? ''] ?? 'other';

/** An id for a category the person adds, from its name, that no other category has. */
export function newCategoryId(label: string): string {
  const base = `c_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'category'}`;
  let id = base; let n = 2;
  while (builtIn.has(id) || config.custom.some((c) => c.id === id)) id = `${base}_${n++}`;
  return id;
}

// ---------------------------------------------------------------------------
// Changes the person makes to the list
// ---------------------------------------------------------------------------

const base = (c?: CategoryConfig | null): CategoryConfig => ({ custom: [...(c?.custom ?? [])], edits: { ...(c?.edits ?? {}) }, merged: { ...(c?.merged ?? {}) } });

/** Add a category. Returns the new configuration and the id it was given. */
export function addCategory(cfg: CategoryConfig | undefined, label: string, group: Category['group']): { config: CategoryConfig; id: string } {
  const prev = getCategoryConfig();
  setCategoryConfig(cfg);                      // so the id is made against the list as it is now, then put back
  const id = newCategoryId(label);
  setCategoryConfig(prev);
  const next = base(cfg);
  next.custom.push({ id, label: label.trim(), group });
  return { config: next, id };
}

/** Rename a category, move it to another group, or hide or show it. Hiding keeps its transactions; it only leaves the pickers. */
export function editCategory(cfg: CategoryConfig | undefined, id: string, patch: { label?: string; group?: Category['group']; hidden?: boolean }): CategoryConfig {
  const next = base(cfg);
  const cur = { ...(next.edits[id] ?? {}), ...patch };
  if (!cur.label?.trim()) delete cur.label;
  if (!cur.hidden) delete cur.hidden;
  if (Object.keys(cur).length) next.edits[id] = cur; else delete next.edits[id];
  return next;
}

/** Fold one category into another: everything in `from` counts as `to`. Refused (null) for the same one, a category that already stands for another, or a loop. */
export function mergeCategory(cfg: CategoryConfig | undefined, from: string, to: string): CategoryConfig | null {
  if (from === to || from === 'uncategorized') return null;
  const next = base(cfg);
  let cur: string | undefined = to;
  for (let i = 0; i < 6 && cur; i++) { if (cur === from) return null; cur = next.merged[cur]; }
  next.merged[from] = to;
  return next;
}
export function unmergeCategory(cfg: CategoryConfig | undefined, from: string): CategoryConfig {
  const next = base(cfg);
  delete next.merged[from];
  return next;
}
/** Take away a category the person added. Built-in categories cannot be deleted, only hidden or merged. */
export function removeCustomCategory(cfg: CategoryConfig | undefined, id: string): CategoryConfig {
  const next = base(cfg);
  next.custom = next.custom.filter((c) => c.id !== id);
  delete next.edits[id];
  for (const k of Object.keys(next.merged)) if (k === id || next.merged[k] === id) delete next.merged[k];
  return next;
}
