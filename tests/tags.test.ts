import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { addCategory, allCategories, categoryGroup, categoryLabel, editCategory, emptyCategoryConfig, everyCategory, mergeCategory, newCategoryId, removeCustomCategory, resolveCategory, setCategoryConfig, unmergeCategory } from '../src/core/categories';
import { matches } from '../src/core/queries';
import { emptyOverlay } from '../src/core/types';
import type { Txn } from '../src/core/types';
import { mergeOverlays, overlayIsEmpty, parseOverlay } from '../src/core/sync';
import { DEFAULT_TAGS, applyTags, autoTagsFor, deleteTag, groupCents, hasWord, itemKey, lineKeys, saveTag, setItemCategory, setTag, tagCents, tagTotals, txnKey } from '../src/core/tags';

afterEach(() => setCategoryConfig());

const t = (id: string, merchant: string, cents: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 'a', date: '2026-07-01', description: merchant.toUpperCase(), merchant, cents, kind: 'spend', source: 's', ...over });
const walmart = (): Txn => t('w', 'Walmart', -4000, { category: 'mixed_retail', lines: [{ item: 'EGGS 12CT', cents: 1000 }, { item: 'IBUPROFEN 200MG', cents: 1200 }, { item: 'TIDE DETERGENT', cents: 1800 }] });

test('words are matched as whole words when short and inside bank text when long', () => {
  assert.ok(hasWord('RX PICKUP', 'rx') && hasWord('AWS EMEA', 'aws'));
  assert.ok(!hasWord('RAWS DELI', 'aws'), 'a short word must stand alone');
  assert.ok(hasWord('WALGREENS #4521 ATLANTA', 'walgreens') && hasWord('CVS/PHARMACY 1234', 'pharmacy'));
  assert.ok(!hasWord('', 'pharmacy') && !hasWord('anything', ''));
});

test('tags come from the words, the category and the Business mark', () => {
  assert.deepEqual(autoTagsFor('CVS PHARMACY 123', undefined, undefined, DEFAULT_TAGS), ['health']);
  assert.deepEqual(autoTagsFor('Some clinic', 'medical', undefined, DEFAULT_TAGS), ['health']);
  assert.deepEqual(autoTagsFor('Plain store', 'household', undefined, DEFAULT_TAGS), ['household']);
  assert.deepEqual(autoTagsFor('Some vendor', undefined, true, DEFAULT_TAGS), ['work']);
  assert.deepEqual(autoTagsFor('Plain store', 'groceries', false, DEFAULT_TAGS), []);
  assert.deepEqual(autoTagsFor('CVS', undefined, undefined, DEFAULT_TAGS.map((d) => ({ ...d, auto: false }))), [], 'a tag whose rules are off is never given');
});

test('a charge is tagged from its merchant and bank text; income and transfers are not', () => {
  const [a, b, c, d] = applyTags([t('1', 'CVS Pharmacy', -1500), t('2', 'Heroku', -700, { business: true }), t('3', 'Salary', 300000, { kind: 'income' }), t('4', 'Corner', -500)]);
  assert.deepEqual(a.tags, ['health']);
  assert.deepEqual(b.tags, ['work']);
  assert.equal(c.tags, undefined);
  assert.deepEqual(d.tags, []);
});

test('items on a big-box receipt get their own tags from their words, and the charge carries them all', () => {
  const [w] = applyTags([walmart()]);
  assert.deepEqual(w.lines!.map((l) => l.tags), [[], ['health'], ['household']]);
  assert.deepEqual([...w.tags!].sort(), ['health', 'household']);
});

test('a tag counts only the items that carry it, so tags overlap without double counting inside a view', () => {
  const [w] = applyTags([walmart()]);
  assert.equal(tagCents(w, 'health'), 1200);
  assert.equal(tagCents(w, 'household'), 1800);
  assert.equal(tagCents(w, 'work'), 0);
  const [cvs] = applyTags([t('c', 'CVS Pharmacy', -2000, { lines: [{ item: 'SHAMPOO', cents: 2000 }] })]);
  assert.equal(tagCents(cvs, 'health'), 2000, 'every item inherits the charge\'s tag');
  const [plain] = applyTags([t('p', 'CVS', -1500)]);
  assert.equal(tagCents(plain, 'health'), 1500);
});

test('the person can take an automatic tag off an item, or put a tag on one, and the amounts follow', () => {
  let s = setTag(undefined, itemKey('w', 'IBUPROFEN 200MG', 1200), 'health', false, true);
  let [w] = applyTags([walmart()], s);
  assert.deepEqual(w.lines![1].tags, []);
  assert.equal(tagCents(w, 'health'), 0);
  assert.deepEqual(w.lines![1].autoTags, ['health'], 'what the rules found is still known, so it can be put back');
  s = setTag(s, itemKey('w', 'EGGS 12CT', 1000), 'health', true, false);
  [w] = applyTags([walmart()], s);
  assert.deepEqual(w.lines![0].tags, ['health']);
  assert.equal(tagCents(w, 'health'), 1000);
  s = setTag(s, itemKey('w', 'IBUPROFEN 200MG', 1200), 'health', true, true);
  [w] = applyTags([walmart()], s);
  assert.equal(tagCents(w, 'health'), 2200, 'putting back an automatic tag just forgets the removal');
  assert.equal(s.edits[itemKey('w', 'IBUPROFEN 200MG', 1200)], undefined);
});

test('a tag taken off a whole charge is taken off its items too, unless an item says otherwise', () => {
  const cvs = () => t('c', 'CVS Pharmacy', -2000, { lines: [{ item: 'SHAMPOO', cents: 1200 }, { item: 'IBUPROFEN', cents: 800 }] });
  const gone = setTag(undefined, txnKey('c'), 'health', false, true);
  let [c] = applyTags([cvs()], gone);
  assert.deepEqual(c.lines!.map((l) => l.tags), [[], ['health']], 'the ibuprofen item carries Health from its own words');
  assert.equal(tagCents(c, 'health'), 800);
  [c] = applyTags([cvs()], setTag(gone, itemKey('c', 'SHAMPOO', 1200), 'health', true, false));
  assert.equal(tagCents(c, 'health'), 2000);
});

test('identical lines are told apart: tagging the second of three Green Onions tags only that one', () => {
  const g = () => t('g', 'ALDI', -267, { lines: [{ item: 'Green Onions', cents: 89 }, { item: 'Green Onions', cents: 89 }, { item: 'Green Onions', cents: 89 }] });
  const [x] = applyTags([g()], setTag(undefined, itemKey('g', 'Green Onions', 89, 1), 'household', true, false));
  assert.deepEqual(x.lines!.map((l) => l.tags), [[], ['household'], []]);
});

test('an item can be given another category, which can itself give a tag', () => {
  const s = setItemCategory(undefined, itemKey('w', 'EGGS 12CT', 1000), 'medical');
  const [w] = applyTags([walmart()], s);
  assert.equal(w.lines![0].category, 'medical');
  assert.deepEqual(w.lines![0].tags, ['health']);
  assert.deepEqual(setItemCategory(s, itemKey('w', 'EGGS 12CT', 1000), undefined).edits, {});
});

test('each tag adds up on its own, overlapping tags are not summed, and the biggest stores are named', () => {
  const rows = applyTags([walmart(), t('c', 'CVS Pharmacy', -3000), t('h', 'Heroku', -700, { business: true })]);
  const tt = Object.fromEntries(tagTotals(rows).map((x) => [x.tag, x]));
  assert.equal(tt.health.cents, 4200);
  assert.equal(tt.health.count, 2);
  assert.deepEqual(tt.health.stores.map((s) => s.merchant), ['CVS Pharmacy', 'Walmart']);
  assert.equal(tt.household.cents, 1800);
  assert.equal(tt.work.cents, 700);
});

test('tags can be added, changed and deleted, and deleting one forgets every change that used it', () => {
  let s = saveTag(undefined, { label: 'Pets', keywords: ['petco', 'vet', 'dog food'] });
  assert.equal(s.defs.at(-1)!.id, 'pets');
  assert.deepEqual(saveTag(s, { label: 'Pets' }).defs.filter((d) => d.id.startsWith('pets')).map((d) => d.id), ['pets', 'pets_2'], 'a second tag with the same name gets its own id');
  const [x] = applyTags([t('p', 'PETCO #12', -4000)], s);
  assert.deepEqual(x.tags, ['pets']);
  s = saveTag(s, { id: 'pets', label: 'Pets and vet', keywords: ['petco'] });
  assert.equal(s.defs.find((d) => d.id === 'pets')!.label, 'Pets and vet');
  s = setTag(s, txnKey('p'), 'pets', true, false);
  s = deleteTag(s, 'pets');
  assert.ok(!s.defs.some((d) => d.id === 'pets'));
  assert.deepEqual(s.edits, {});
});

test('categories can be added, renamed, regrouped, hidden and merged, and every screen sees the change', () => {
  assert.equal(categoryLabel('medical'), 'Medical');
  const id = newCategoryId('Pet care');
  assert.equal(id, 'c_pet_care');
  setCategoryConfig({ custom: [{ id, label: 'Pet care', group: 'need' }], edits: { medical: { label: 'Healthcare', group: 'need' }, restaurants: { hidden: true } }, merged: { phone: 'other' } });
  assert.equal(categoryLabel(id), 'Pet care');
  assert.equal(categoryLabel('medical'), 'Healthcare');
  assert.equal(categoryGroup('medical'), 'need');
  assert.equal(resolveCategory('phone'), 'other');
  assert.equal(categoryLabel('phone'), 'Other', 'a merged category counts as the one it was folded into');
  const ids = allCategories().map((c) => c.id);
  assert.ok(ids.includes(id) && !ids.includes('restaurants') && !ids.includes('phone') && ids.includes('uncategorized'));
  assert.ok(everyCategory().some((c) => c.id === 'restaurants'), 'hidden ones are still listed for the management screen');
  assert.equal(newCategoryId('Pet care'), 'c_pet_care_2');
  setCategoryConfig();
  assert.equal(categoryLabel('medical'), 'Medical');
  assert.deepEqual(emptyCategoryConfig().custom, []);
});

test('a charge in a merged-away or renamed category still gets its tag through the category it now counts as', () => {
  setCategoryConfig({ merged: { c_old_health: 'medical' } });
  assert.deepEqual(autoTagsFor('x', 'c_old_health', undefined, DEFAULT_TAGS), ['health']);
});

test('categories and tags survive the network: they parse, merge from two devices, and count as saved decisions', () => {
  const a = { ...emptyOverlay(), categories: { custom: [{ id: 'c_a', label: 'A', group: 'need' as const }], edits: { medical: { label: 'Healthcare' } }, merged: {} }, tags: { defs: DEFAULT_TAGS, edits: { 't:1': { add: ['work'] } } } };
  const b = { ...emptyOverlay(), categories: { custom: [{ id: 'c_b', label: 'B', group: 'want' as const }], edits: {}, merged: { phone: 'other' } }, tags: { defs: DEFAULT_TAGS.slice(0, 2), edits: { 't:2': { remove: ['health'] } } } };
  const m = mergeOverlays(a, b);
  assert.deepEqual(m.categories!.custom.map((c) => c.id).sort(), ['c_a', 'c_b']);
  assert.equal(m.categories!.edits.medical.label, 'Healthcare');
  assert.equal(m.categories!.merged.phone, 'other');
  assert.deepEqual(Object.keys(m.tags!.edits).sort(), ['t:1', 't:2']);
  assert.equal(m.tags!.defs.length, 2, 'the tag list is one list: the remote device\'s wins');
  const p = parseOverlay(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(p.categories, m.categories);
  assert.deepEqual(p.tags, m.tags);
  assert.equal(parseOverlay({}).tags, undefined);
  assert.ok(overlayIsEmpty(emptyOverlay()));
  assert.ok(!overlayIsEmpty({ ...emptyOverlay(), tags: { defs: [], edits: { 't:1': { add: ['x'] } } } }));
  assert.ok(!overlayIsEmpty({ ...emptyOverlay(), categories: { custom: [], edits: { medical: { hidden: true } }, merged: {} } }));
});


test('the list is edited with plain steps: add, rename, hide, merge (never into itself or in a loop), undo and remove', () => {
  const { config: c1, id } = addCategory(undefined, 'Pet care', 'need');
  assert.equal(id, 'c_pet_care');
  assert.equal(addCategory(c1, 'Pet care', 'need').id, 'c_pet_care_2');
  const c2 = editCategory(c1, 'medical', { label: 'Healthcare' });
  assert.equal(c2.edits.medical.label, 'Healthcare');
  assert.deepEqual(editCategory(c2, 'medical', { label: '   ' }).edits, {}, 'a blank name goes back to the built-in one');
  assert.equal(editCategory(c2, 'restaurants', { hidden: true }).edits.restaurants.hidden, true);
  assert.equal(mergeCategory(c2, 'phone', 'phone'), null);
  assert.equal(mergeCategory(c2, 'uncategorized', 'other'), null);
  const c3 = mergeCategory(c2, 'phone', 'other')!;
  assert.equal(c3.merged.phone, 'other');
  assert.equal(mergeCategory(c3, 'other', 'phone'), null, 'a loop is refused');
  assert.deepEqual(unmergeCategory(c3, 'phone').merged, {});
  const c4 = removeCustomCategory(mergeCategory(c3, id, 'other')!, id);
  assert.deepEqual(c4.custom, []);
  assert.equal(c4.merged[id], undefined);
});

test('charges can be listed by tag, and the Want group adds up item by item where items are known', () => {
  const rows = applyTags([walmart(), t('c', 'CVS Pharmacy', -3000)]);
  assert.deepEqual(rows.filter((r) => matches(r, { tags: ['health'] })).map((r) => r.id), ['w', 'c']);
  assert.deepEqual(rows.filter((r) => matches(r, { tags: ['household'] })).map((r) => r.id), ['w']);
  assert.equal(rows.filter((r) => matches(r, { tags: ['work'] })).length, 0);
  const mixed = t('m', 'Target', -3000, { category: 'mixed_retail', lines: [{ item: 'Shirt', cents: 1000, category: 'entertainment' }, { item: 'Milk', cents: 2000, category: 'groceries' }] });
  assert.equal(groupCents([mixed], 'want'), 1000);
  assert.equal(groupCents([mixed], 'need'), 2000);
  assert.equal(groupCents([t('r', 'Cinema', -1500, { category: 'entertainment' })], 'want'), 1500);
  assert.equal(groupCents([t('i', 'Pay', 5000, { kind: 'income' })], 'want'), 0);
});

test('identical lines are numbered in order, the same way the tags read them', () => {
  assert.deepEqual(lineKeys('g', [{ item: 'Green Onions', cents: 89 }, { item: 'Milk', cents: 300 }, { item: 'Green Onions', cents: 89 }]), [itemKey('g', 'Green Onions', 89, 0), itemKey('g', 'Milk', 300, 0), itemKey('g', 'Green Onions', 89, 1)]);
});
