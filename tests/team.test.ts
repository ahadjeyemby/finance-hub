import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyIncome } from '../src/core/income';
import { applyOverlay } from '../src/core/queries';
import { applyLinks } from '../src/core/links';
import { applyTags, DEFAULT_TAGS, itemKey, txnKey } from '../src/core/tags';
import { combineTeam, inView, mergeCategoryConfigs, mergeIncomes, mergeTagStates, nsAccount, nsId, nsTagKey, nsTxn, ownCategoryConfig, ownIncomeState, ownTagState } from '../src/core/team';
import type { PersonData } from '../src/core/team';
import { emptyOverlay } from '../src/core/types';
import type { Account, Overlay, Txn } from '../src/core/types';

const ME = 'me-0000', SAM = 'sam-0001', PAT = 'pat-0002';
const acct = (id: string, type: Account['type'] = 'checking'): Account => ({ id, name: id, institution: 'X', type, last4: '1234', coverage: { from: '2026-01-01', to: '2026-06-30' } });
const t = (id: string, merchant: string, cents: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 'acc', date: '2026-03-01', description: merchant.toUpperCase(), merchant, cents, kind: 'spend', source: 's', ...over });
const person = (id: string, txns: Txn[], overlay: Overlay = emptyOverlay(), accounts: Account[] = [acct('acc')]): PersonData => ({ id, accounts, txns, overlay, links: null });
const own = (p: PersonData) => ({ ...p, tags: { defs: DEFAULT_TAGS, edits: p.overlay.tags?.edits ?? {} }, income: p.overlay.income ?? emptyIncome() });

test('two people with the same ids stay two people: the member\'s ids move into their own space, the admin\'s do not change', () => {
  const c = combineTeam(own(person(ME, [t('t1', 'Walmart', -1000)])), [person(SAM, [t('t1', 'Target', -2000)])]);
  assert.deepEqual(c.txns.map((x) => [x.id, x.owner]).sort(), [['sam-0001:t1', SAM], ['t1', ME]].sort());
  assert.deepEqual(c.accounts.map((a) => [a.id, a.owner]).sort(), [['acc', ME], ['sam-0001:acc', SAM]].sort());
  assert.equal(c.txns.find((x) => x.owner === SAM)!.accountId, 'sam-0001:acc', 'charges point at the member\'s account');
  assert.equal(new Set(c.txns.map((x) => x.id)).size, 2);
});

test('pair ids follow, and the cash pseudo-account stays one shared name', () => {
  const x = nsTxn(SAM, t('t1', 'Card payment', -500, { pairId: 'p9' }));
  assert.equal(x.pairId, 'sam-0001:p9');
  assert.equal(nsTxn(SAM, t('cash:1', 'Cash', -500, { accountId: 'cash', manual: true })).accountId, 'cash');
  assert.equal(nsAccount(SAM, acct('cash', 'cash')).id, 'cash');
  const c = combineTeam(own(person(ME, [], emptyOverlay(), [acct('cash', 'cash')])), [person(SAM, [], emptyOverlay(), [acct('cash', 'cash')])]);
  assert.equal(c.accounts.filter((a) => a.id === 'cash').length, 1, 'no duplicate cash account');
});

test('a member\'s own decisions are applied as they made them, and the admin\'s decisions are layered over everything', () => {
  const memberOverlay: Overlay = { ...emptyOverlay(), patches: { t1: { category: 'groceries' } }, merchantRules: { Target: { category: 'household' } } };
  const members = [person(SAM, [t('t1', 'Walmart', -1000), t('t2', 'Target', -2000)], memberOverlay)];
  const c = combineTeam(own(person(ME, [t('t1', 'Walmart', -1000)])), members);
  const get = (id: string) => c.txns.find((x) => x.id === id)!;
  assert.equal(get('sam-0001:t1').category, 'groceries', 'her own patch');
  assert.equal(get('sam-0001:t2').category, 'household', 'her own merchant rule');
  // the admin recategorises her charge and his own, by the ids he sees
  const adminOverlay: Overlay = { ...emptyOverlay(), patches: { 'sam-0001:t1': { category: 'medical' }, t1: { category: 'fuel' } } };
  const seen = applyOverlay(c.txns, adminOverlay);
  assert.equal(seen.find((x) => x.id === 'sam-0001:t1')!.category, 'medical', 'the admin\'s view');
  assert.equal(seen.find((x) => x.id === 't1')!.category, 'fuel');
  assert.equal(seen.find((x) => x.id === 'sam-0001:t2')!.category, 'household', 'untouched charges keep her decisions');
  // and nothing the admin did reached her data
  assert.equal(members[0].overlay.patches['sam-0001:t1'], undefined);
  assert.equal(members[0].txns[0].category, undefined);
});

test('a member\'s cash entries come along, with the admin\'s merchant rules applied over them', () => {
  const sam: Overlay = { ...emptyOverlay(), manual: [t('cash:5', 'Market', -700, { accountId: 'cash', manual: true })] };
  const c = combineTeam(own(person(ME, [])), [person(SAM, [], sam)]);
  const m = c.txns.find((x) => x.manual)!;
  assert.equal(m.id, 'sam-0001:cash:5'); assert.equal(m.owner, SAM); assert.equal(m.accountId, 'cash');
  assert.equal(applyOverlay(c.txns, { ...emptyOverlay(), merchantRules: { Market: { category: 'groceries' } } }).find((x) => x.manual)!.category, 'groceries');
});

test('tag edits move into the member\'s id space, a member\'s own tags are kept, and the admin wins a clash', () => {
  assert.equal(nsTagKey(SAM, txnKey('t1')), 't:sam-0001:t1');
  assert.equal(nsTagKey(SAM, itemKey('t1', 'Ibuprofen 200MG', 1200, 2)), `i:sam-0001:t1:1200:ibuprofen_200mg:2`);
  assert.equal(nsTagKey(SAM, itemKey('cash:77', 'Milk', 300)), 'i:sam-0001:cash:77:300:milk:0', 'ids that contain a colon survive');
  assert.equal(nsTagKey(SAM, 'something-else'), 'something-else');
  const samTags = { defs: [...DEFAULT_TAGS, { id: 'pets', label: 'Pets', keywords: ['petco'], auto: true }], edits: { [txnKey('t1')]: { add: ['kids'] }, [txnKey('t2')]: { add: ['kids'] } } };
  const merged = mergeTagStates({ defs: DEFAULT_TAGS, edits: { [txnKey('sam-0001:t2')]: { remove: ['kids'] } } }, [{ id: SAM, tags: samTags }]);
  assert.ok(merged.defs.some((d) => d.id === 'pets'), 'her own tag is listed');
  assert.equal(merged.defs.filter((d) => d.id === 'health').length, 1);
  assert.deepEqual(merged.edits['t:sam-0001:t1'], { add: ['kids'] });
  assert.deepEqual(merged.edits['t:sam-0001:t2'], { remove: ['kids'] }, 'the admin\'s edit wins');
  // end to end: her tag shows on her charge in the admin's view, and not on the admin's charge with the same id
  const c = combineTeam(own(person(ME, [t('t1', 'Walmart', -1000)])), [person(SAM, [t('t1', 'Walmart', -1000)], { ...emptyOverlay(), tags: samTags })]);
  const tagged = applyTags(c.txns, c.tags);
  assert.ok(tagged.find((x) => x.id === 'sam-0001:t1')!.tags?.includes('kids'));
  assert.ok(!tagged.find((x) => x.id === 't1')!.tags?.includes('kids'));
});

test('a member\'s receipts, links and flags are carried over under the member\'s ids', () => {
  const rec = { id: 'r-aaaa', merchant: 'Target', lines: [{ item: 'Soap', cents: 500 }] } as never;
  const samLinks = { links: [{ receiptId: 'r-aaaa', txnId: 't1', role: 'primary', method: 'manual', confirmed: true } as never], flags: [{ kind: 'txn', refId: 't9', reason: 'no_receipt' } as never, { kind: 'receipt', refId: 'r-bbbb', reason: 'cash' } as never], receipts: [rec] };
  const c = combineTeam(own(person(ME, [t('t1', 'Walmart', -1000)])), [{ ...person(SAM, [t('t1', 'Target', -500)]), links: samLinks }]);
  assert.equal(c.links!.links[0].txnId, 'sam-0001:t1');
  assert.deepEqual(c.links!.flags.map((f) => f.refId), ['sam-0001:t9', 'r-bbbb'], 'a charge flag moves, a receipt flag (a uuid) does not');
  assert.equal(c.links!.receipts.length, 1);
  // her receipt attaches to her charge only
  const linked = applyLinks(c.txns, c.links!.links, new Map(c.links!.receipts.map((r) => [r.id, r])), c.links!.flags);
  assert.ok(linked.find((x) => x.id === 'sam-0001:t1')!.receiptId === 'r-aaaa' || linked.find((x) => x.id === 'sam-0001:t1')!.lines?.length);
  assert.ok(!linked.find((x) => x.id === 't1')!.receiptId);
  assert.equal(combineTeam(own(person(ME, [])), [person(SAM, [])]).links, null, 'no links anywhere stays null');
});

test('categories members made are listed; renames and merges stay the admin\'s', () => {
  const mine = { custom: [{ id: 'c_pets', label: 'Pets', group: 'want' as const }], edits: { fuel: { label: 'Gas' } }, merged: { a: 'b' } };
  const hers = { custom: [{ id: 'c_pets', label: 'Pets 2', group: 'want' as const }, { id: 'c_gym', label: 'Gym', group: 'want' as const }], edits: { fuel: { label: 'Petrol' } }, merged: { x: 'y' } };
  const m = mergeCategoryConfigs(mine, [hers])!;
  assert.deepEqual(m.custom.map((c) => c.id), ['c_pets', 'c_gym']);
  assert.equal(m.custom[0].label, 'Pets', 'the admin\'s version of a shared id');
  assert.deepEqual(m.edits, mine.edits); assert.deepEqual(m.merged, mine.merged);
  assert.equal(mergeCategoryConfigs(undefined, [undefined]), undefined);
  assert.equal(mergeCategoryConfigs(undefined, [hers])!.custom.length, 2);
});

test('income sources and pay records of everyone are available, with a member\'s hand assignments in their id space', () => {
  const src = (id: string) => ({ id, name: id, type: 'salary' as const, words: [] });
  const mine = { ...emptyIncome(), sources: [src('job')], assign: { t1: 'job' } };
  const hers = { sources: [src('hisjob')], records: [], assign: { t1: 'hisjob' } };
  const m = mergeIncomes(mine, [{ id: SAM, income: hers }]);
  assert.deepEqual(m.sources.map((s) => s.id), ['job', 'hisjob']);
  assert.deepEqual(m.assign, { 'sam-0001:t1': 'hisjob', t1: 'job' });
});

test('who is in view: everyone, or one person; a row with no owner is the signed-in person\'s', () => {
  assert.ok(inView(undefined, 'all', ME) && inView(SAM, 'all', ME));
  assert.ok(inView(undefined, ME, ME) && inView(ME, ME, ME) && !inView(SAM, ME, ME));
  assert.ok(inView(SAM, SAM, ME) && !inView(undefined, SAM, ME) && !inView(PAT, SAM, ME));
  assert.ok(inView(undefined, 'me', ME) && inView(ME, 'me', ME) && !inView(SAM, 'me', ME), '"me" means the signed-in person');
  assert.equal(nsId(SAM, 'x'), 'sam-0001:x');
});

test('with no members nothing changes except that rows say whose they are', () => {
  const base = person(ME, [t('t1', 'Walmart', -1000), t('t2', 'Target', -500)]);
  const c = combineTeam(own(base), []);
  assert.deepEqual(c.txns.map((x) => x.id), ['t1', 't2']);
  assert.deepEqual(c.accounts.map((a) => a.id), ['acc']);
  assert.deepEqual(c.tags.defs, DEFAULT_TAGS);
});

test('combining never changes what it was given', () => {
  const sam = person(SAM, [t('t1', 'Target', -2000)], { ...emptyOverlay(), patches: { t1: { category: 'groceries' } } });
  const before = JSON.stringify(sam);
  combineTeam(own(person(ME, [t('t1', 'Walmart', -1000)])), [sam]);
  assert.equal(JSON.stringify(sam), before);
});

test('saving puts only the admin\'s own changes back: what came from members stays with them, what the admin changed is kept', () => {
  const samTags = { defs: [...DEFAULT_TAGS, { id: 'pets', label: 'Pets', keywords: ['petco'], auto: true }], edits: { [txnKey('t1')]: { add: ['kids'] } } };
  const fromMembers = mergeTagStates({ defs: [], edits: {} }, [{ id: SAM, tags: samTags }]);
  const before = { defs: DEFAULT_TAGS, edits: {} };
  const shown = mergeTagStates(before, [{ id: SAM, tags: samTags }]);
  // the admin saves without touching her tags: nothing of hers is copied
  const untouched = ownTagState(shown, fromMembers, before);
  assert.deepEqual(untouched.edits, {});
  assert.ok(!untouched.defs.some((d) => d.id === 'pets'));
  // the admin adds a tag to one of her charges and a tag of their own: both are kept, and hers still are not
  const changed = ownTagState({ defs: [...shown.defs, { id: 'own', label: 'Own', keywords: [], auto: true }], edits: { ...shown.edits, 't:sam-0001:t1': { add: ['kids', 'health'] }, 't:t9': { add: ['kids'] } } }, fromMembers, before);
  assert.deepEqual(changed.edits, { 't:sam-0001:t1': { add: ['kids', 'health'] }, 't:t9': { add: ['kids'] } });
  assert.ok(changed.defs.some((d) => d.id === 'own') && !changed.defs.some((d) => d.id === 'pets'));
  // what was already the admin's stays, even if it equals hers
  const kept = ownTagState(shown, fromMembers, { defs: DEFAULT_TAGS, edits: { 't:sam-0001:t1': { add: ['kids'] } } });
  assert.deepEqual(kept.edits, { 't:sam-0001:t1': { add: ['kids'] } });
});

test('saving categories and income leaves members\' own items with them', () => {
  const hers = { custom: [{ id: 'c_gym', label: 'Gym', group: 'want' as const }], edits: {}, merged: {} };
  const mine = { custom: [{ id: 'c_pets', label: 'Pets', group: 'want' as const }], edits: {}, merged: {} };
  const shown = mergeCategoryConfigs(mine, [hers])!;
  assert.deepEqual(ownCategoryConfig(shown, hers, mine)!.custom.map((c) => c.id), ['c_pets']);
  assert.deepEqual(ownCategoryConfig({ ...shown, custom: [...shown.custom, { id: 'c_new', label: 'New', group: 'need' as const }] }, hers, mine)!.custom.map((c) => c.id), ['c_pets', 'c_new']);
  assert.equal(ownCategoryConfig(undefined, hers, mine), undefined);

  const src = (id: string) => ({ id, name: id, type: 'salary' as const, words: [] });
  const myInc = { ...emptyIncome(), sources: [src('job')] };
  const herInc = mergeIncomes(emptyIncome(), [{ id: SAM, income: { sources: [src('hisjob')], records: [], assign: { t1: 'hisjob' } } }]);
  const shownInc = mergeIncomes(myInc, [{ id: SAM, income: { sources: [src('hisjob')], records: [], assign: { t1: 'hisjob' } } }]);
  const saved = ownIncomeState({ ...shownInc, assign: { ...shownInc.assign, 'sam-0001:t7': 'job' } }, herInc, myInc);
  assert.deepEqual(saved.sources.map((s) => s.id), ['job']);
  assert.deepEqual(saved.assign, { 'sam-0001:t7': 'job' }, 'the admin\'s own assignment of one of her deposits is kept; her own is not copied');
});
