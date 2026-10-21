import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CASH_TABS, buildCash, cashChanged, checkCash, emptyCashForm, firstOpenTab, formToDraft, suggestedCategory, tabStatus, txnToForm } from '../src/core/cashform';
import type { CashForm } from '../src/core/cashform';
import type { Txn } from '../src/core/types';

const TODAY = '2026-06-10';
const form = (over: Partial<CashForm> = {}): CashForm => ({ ...emptyCashForm(TODAY), amount: '24.50', merchant: 'Corner Market', what: 'vegetables', category: 'groceries', ...over });

test('an empty form says what is missing, field by field', () => {
  const c = checkCash(emptyCashForm(TODAY));
  assert.deepEqual(Object.keys(c.errors).sort(), ['amount', 'category', 'merchant']);
  assert.ok(!c.ok);
  assert.ok(checkCash(form()).ok);
});

test('amounts, dates and items are checked in plain words and never adjusted', () => {
  assert.match(checkCash(form({ amount: '0' })).errors.amount!, /above zero/);
  assert.match(checkCash(form({ amount: 'abc' })).errors.amount!, /above zero/);
  assert.match(checkCash(form({ date: 'yesterday' })).errors.date!, /YYYY-MM-DD/);
  assert.ok(checkCash(form({ date: '06/09/2026' })).ok, 'a US date is accepted');
  assert.equal(formToDraft(form({ date: '06/09/2026' })).date, '2026-06-09');
  assert.match(checkCash(form({ items: 'tomatoes 4.50\nrice' })).errors.items!, /Could not read: rice/);
  assert.match(checkCash(form({ items: 'tomatoes 20, rice 10' })).errors.items!, /add up to \$30\.00, more than the \$24\.50/);
});

test('items that add up to less are kept and the rest is one remainder line', () => {
  const f = form({ items: 'tomatoes 4.50\nrice 12' });
  const c = checkCash(f);
  assert.ok(c.ok); assert.equal(c.remainderCents, 800);
  const t = buildCash(f, TODAY, 1);
  assert.deepEqual(t.lines, [{ item: 'tomatoes', cents: 450 }, { item: 'rice', cents: 1200 }, { item: 'Other (not itemised)', cents: 800 }]);
  assert.equal(t.cents, -2450); assert.equal(t.kind, 'spend'); assert.equal(t.manual, true); assert.equal(t.accountId, 'cash');
  assert.equal(buildCash(form(), TODAY, 1).lines, undefined, 'no items, no lines');
});

test('the tabs say where things stand and where to go next', () => {
  const s0 = tabStatus(emptyCashForm(TODAY));
  assert.deepEqual([s0.amount, s0.details, s0.items, s0.review], ['todo', 'todo', 'optional', 'todo']);
  assert.equal(firstOpenTab(emptyCashForm(TODAY)), 'amount');
  assert.equal(firstOpenTab(form({ category: '' })), 'details');
  assert.equal(firstOpenTab(form({ items: 'rice' })), 'items');
  assert.equal(firstOpenTab(form()), 'review');
  const typed = tabStatus(form({ amount: 'oops' }));
  assert.equal(typed.amount, 'error', 'something typed that is wrong is an error, not just empty');
  assert.deepEqual(tabStatus(form({ items: 'rice 3' })).items, 'done');
  assert.deepEqual(CASH_TABS.map((t) => t.id), ['amount', 'details', 'items', 'review']);
});

test('a category is suggested from what was typed', () => {
  assert.equal(suggestedCategory(form({ merchant: 'Shell', what: 'gas' })), 'fuel');
  assert.equal(suggestedCategory(form({ merchant: 'Zzz', what: 'qqq' })), undefined);
});

test('an entry saved earlier opens as the same form, and saving it again keeps its identity', () => {
  const saved = buildCash(form({ items: 'tomatoes 4.50' }), TODAY, 1700000000000);
  const back = txnToForm(saved);
  assert.deepEqual(back, form({ items: 'tomatoes 4.50', what: 'vegetables', date: TODAY }), 'the remainder line is not shown as an item');
  assert.ok(!cashChanged(back, txnToForm(saved)));
  const changed = buildCash({ ...back, amount: '30.00', merchant: 'Corner Market 2' }, TODAY, 1800000000000, { ...saved, receiptId: 'r-1' });
  assert.equal(changed.id, saved.id); assert.equal(changed.createdAt, saved.createdAt); assert.equal(changed.receiptId, 'r-1');
  assert.equal(changed.editedAt, new Date(1800000000000).toISOString());
  assert.equal(changed.cents, -3000); assert.equal(changed.merchant, 'Corner Market 2');
  assert.deepEqual(changed.lines!.map((l) => l.cents), [450, 2550], 'the remainder follows the new amount');
  assert.ok(cashChanged(back, { ...back, amount: '30.00' }));
});

test('what an entry was typed as "what" survives a round trip, and a flag set once stays set', () => {
  const t: Txn = buildCash(form({ business: true, oneOff: true, amount: '150' }), TODAY, 5);
  const f = txnToForm(t);
  assert.ok(f.business && f.oneOff && f.what === 'vegetables');
  assert.equal(buildCash(f, TODAY, 6, t).business, true);
});

test('when two devices meet, the later edit of a cash entry wins, and the remote wins when neither was edited', async () => {
  const { mergeOverlays } = await import('../src/core/sync');
  const { emptyOverlay } = await import('../src/core/types');
  const base = buildCash(form(), TODAY, 1000);
  const edited = buildCash({ ...txnToForm(base), amount: '99.00' }, TODAY, 2000, base);
  const older = { ...base };
  const mk = (t: Txn) => ({ ...emptyOverlay(), manual: [t] });
  assert.equal(mergeOverlays(mk(edited), mk(older)).manual[0].cents, -9900, 'local edit survives an older remote copy');
  assert.equal(mergeOverlays(mk(older), mk(edited)).manual[0].cents, -9900, 'a newer remote edit replaces the local copy');
  assert.equal(mergeOverlays(mk({ ...base, note: 'local' }), mk({ ...base, note: 'remote' })).manual[0].note, 'remote', 'neither edited: the remote, as before');
});

test('editing a stored receipt writes its own details and leaves the file, the link and the rest of what was read alone', async () => {
  const { receiptUpdate } = await import('../src/core/evidence');
  const rec = { merchant: 'ALDI', date: '2026-03-01', totalCents: 1500, taxCents: 100, lines: [{ item: 'EGGS', cents: 1400 }], charges: [{ label: 'Bag fee', cents: 10 }], itemCount: 1, sha256: 'abc', sourceFile: 'a.jpg', txnId: 't9' } as never;
  const stored = { notes: 'read by haiku', duplicateOf: 'r-0', charges: [{ label: 'old', cents: 1 }], itemCount: 7, paidOther: { cents: 50, label: 'points' } };
  const u = receiptUpdate(rec, stored) as Record<string, any>;
  for (const k of ['sha256', 'source_file', 'storage_path', 'txn_id', 'origin', 'captured_at']) assert.ok(!(k in u), `${k} is not rewritten`);
  assert.equal(u.merchant, 'ALDI'); assert.equal(u.total_cents, 1500); assert.deepEqual(u.lines, [{ item: 'EGGS', cents: 1400 }]);
  assert.deepEqual(u.raw.charges, [{ label: 'Bag fee', cents: 10 }], 'the edited charges replace the old ones');
  assert.equal(u.raw.itemCount, 1);
  assert.equal(u.raw.notes, 'read by haiku', 'what else was read stays'); assert.equal(u.raw.duplicateOf, 'r-0');
  assert.ok(!('paidOther' in u.raw), 'points paid that were cleared are removed');
  assert.deepEqual(Object.keys(receiptUpdate(rec, undefined) as object).includes('raw'), true);
});
