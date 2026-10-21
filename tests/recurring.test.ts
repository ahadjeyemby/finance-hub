import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addManual, addMonthsTo, decide, detectCadence, emptyRecurring, removeManual, summarizeRecurring } from '../src/core/recurring';
import type { Txn } from '../src/core/types';

let n = 0;
const t = (merchant: string, date: string, dollars: number, over: Partial<Txn> = {}): Txn => ({ id: `t${n++}`, accountId: 'a', date, description: merchant.toUpperCase(), merchant, cents: -Math.round(dollars * 100), kind: 'spend', source: 's', ...over });
const monthly = (merchant: string, dollars: number, from = '2026-01-05', months = 6, over: Partial<Txn> = {}) => Array.from({ length: months }, (_, i) => t(merchant, addMonthsTo(from, i), dollars, over));

test('calendar months keep the day, or the last day of a shorter month', () => {
  assert.equal(addMonthsTo('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsTo('2026-12-15', 2), '2027-02-15');
  assert.equal(addMonthsTo('2026-03-31', -1), '2026-02-28');
});

test('the rhythm is found from the gaps between charges', () => {
  assert.equal(detectCadence(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05']), 'monthly');
  assert.equal(detectCadence(['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23']), 'weekly');
  assert.equal(detectCadence(['2026-01-02', '2026-01-16', '2026-01-30']), 'biweekly');
  assert.equal(detectCadence(['2026-01-10', '2026-04-10', '2026-07-10']), 'quarterly');
  assert.equal(detectCadence(['2024-03-01', '2025-03-01', '2026-03-02']), 'annual');
  assert.equal(detectCadence(['2026-01-05', '2026-01-19', '2026-03-30', '2026-04-02']), null, 'no steady rhythm');
  assert.equal(detectCadence(['2026-01-05']), null);
});

test('a monthly subscription is found, with its next date and monthly cost', () => {
  const s = summarizeRecurring(monthly('Anthropic', 20), undefined, '2026-06-20');
  assert.equal(s.items.length, 1);
  const i = s.items[0];
  assert.equal(i.cadence, 'monthly');
  assert.equal(i.cents, 2000);
  assert.equal(i.monthlyCents, 2000);
  assert.equal(i.lastDate, '2026-06-05');
  assert.equal(i.nextDue, '2026-07-05');
  assert.ok(i.projected);
  assert.equal(i.health, 'active');
  assert.equal(i.source, 'detected');
  assert.equal(s.fixedMonthlyCents, 2000);
  assert.equal(s.unconfirmedMonthlyCents, 2000);
});

test('a yearly charge costs a twelfth per month and a weekly one 52 over 12', () => {
  const yearly = [t('Amazon Prime', '2024-03-12', 139), t('Amazon Prime', '2025-03-12', 139), t('Amazon Prime', '2026-03-12', 139)];
  const y = summarizeRecurring(yearly, undefined, '2026-06-20').items[0];
  assert.equal(y.cadence, 'annual');
  assert.equal(y.monthlyCents, Math.round(13900 / 12));
  assert.equal(y.nextDue, '2027-03-12');
  const weekly = Array.from({ length: 6 }, (_, i) => t('Gym Pass', new Date(Date.parse('2026-05-01') + i * 7 * 86400000).toISOString().slice(0, 10), 10));
  const w = summarizeRecurring(weekly, undefined, '2026-06-10').items[0];
  assert.equal(w.cadence, 'weekly');
  assert.equal(w.monthlyCents, Math.round(1000 * 52 / 12));
});

test('groceries and fuel repeat but are not fixed, unless the person confirms them', () => {
  const tx = monthly('Costco', 150, '2026-01-05', 6, { category: 'groceries' });
  assert.equal(summarizeRecurring(tx, undefined, '2026-06-20').items.length, 0);
  const confirmed = decide(undefined, 'costco', 'confirmed');
  const s = summarizeRecurring(tx, confirmed, '2026-06-20');
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].source, 'confirmed');
  assert.equal(s.unconfirmedMonthlyCents, 0);
});

test('one-off purchases, refunds and income are not recurring', () => {
  const tx = [t('Best Buy', '2026-02-01', 400), t('Best Buy', '2026-05-20', 90), t('Employer', '2026-01-15', -3000, { kind: 'income' }), t('Employer', '2026-02-15', -3000, { kind: 'income' })];
  assert.equal(summarizeRecurring(tx, undefined, '2026-06-20').items.length, 0);
});

test('two charges only count when they match, and a bill may wobble once there are three', () => {
  assert.equal(summarizeRecurring([t('Netflix', '2026-05-03', 15.49), t('Netflix', '2026-06-03', 22)], undefined, '2026-06-20').items.length, 0);
  assert.equal(summarizeRecurring([t('Netflix', '2026-05-03', 15.49), t('Netflix', '2026-06-03', 15.49)], undefined, '2026-06-20').items.length, 1);
  const bill = ['2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10'].map((d, i) => t('Georgia Power', d, [92, 118, 140, 105][i]));
  const i = summarizeRecurring(bill, undefined, '2026-06-20').items[0];
  assert.ok(i.varies);
  assert.equal(i.cents, 11150, 'a varying bill is planned at its median');
});

test('a price change is reported, not hidden', () => {
  const tx = [...monthly('Spotify', 10.99, '2026-01-08', 5), t('Spotify', '2026-06-08', 12.99)];
  const i = summarizeRecurring(tx, undefined, '2026-06-20').items[0];
  assert.deepEqual(i.change, { from: 1099, to: 1299 });
  assert.equal(i.cents, 1299, 'the new price is the one planned for');
  assert.equal(summarizeRecurring(monthly('Spotify', 10.99), undefined, '2026-06-20').items[0].change, undefined);
});

test('a missed charge makes it late, and two make it stopped and out of the total', () => {
  const tx = monthly('Hulu', 17.99, '2026-01-05', 4);   // last 2026-04-05
  const late = summarizeRecurring(tx, undefined, '2026-06-01').items[0];
  assert.equal(late.health, 'late');
  assert.equal(summarizeRecurring(tx, undefined, '2026-06-01').fixedMonthlyCents, 1799);
  const gone = summarizeRecurring(tx, undefined, '2026-08-01');
  assert.equal(gone.items[0].health, 'stopped');
  assert.equal(gone.fixedMonthlyCents, 0);
  // inside the grace window right after the due date it is still on rhythm
  assert.equal(summarizeRecurring(tx, undefined, '2026-05-07').items[0].health, 'active');
});

test('the same payee at two prices is two subscriptions', () => {
  const tx = [...monthly('Apple', 0.99, '2026-01-04', 5), ...monthly('Apple', 9.99, '2026-01-12', 5)];
  const s = summarizeRecurring(tx, undefined, '2026-06-01');
  assert.equal(s.items.length, 2);
  assert.deepEqual(s.items.map((i) => i.cents).sort((a, b) => a - b), [99, 999]);
  assert.equal(s.fixedMonthlyCents, 1098);
});

test('ignored and cancelled items are listed but left out of the fixed total', () => {
  const tx = [...monthly('Anthropic', 20), ...monthly('Dropbox', 12)];
  const a = summarizeRecurring(tx, undefined, '2026-06-20');
  assert.equal(a.fixedMonthlyCents, 3200);
  const b = summarizeRecurring(tx, decide(decide(undefined, 'dropbox', 'cancelled'), 'anthropic', 'ignored'), '2026-06-20');
  assert.equal(b.fixedMonthlyCents, 0);
  assert.deepEqual(b.items.map((i) => i.status).sort(), ['cancelled', 'ignored']);
  const cleared = decide(decide(undefined, 'dropbox', 'cancelled'), 'dropbox', null);
  assert.deepEqual(cleared.edits, {});
});

test('the person can set their own amount and rhythm for an item', () => {
  const s = decide(undefined, 'anthropic', 'confirmed', { cents: 2500, cadence: 'quarterly' });
  const i = summarizeRecurring(monthly('Anthropic', 20), s, '2026-06-20').items[0];
  assert.equal(i.cents, 2500);
  assert.equal(i.cadence, 'quarterly');
  assert.equal(i.monthlyCents, Math.round(2500 / 3));
});

test('rent paid in cash is added by hand, repeats on its day, and gives way once statements show it', () => {
  const s = addManual(undefined, { merchant: 'House rent', cents: 150000, cadence: 'monthly', anchor: '2026-06-01', category: 'rent' });
  const r = summarizeRecurring([], s, '2026-06-20', '2026-06-20');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].source, 'manual');
  assert.equal(r.items[0].nextDue, '2026-07-01');
  assert.equal(r.fixedMonthlyCents, 150000);
  // the same payee now appears in a statement: one item, not two
  const both = summarizeRecurring(monthly('House Rent', 1500, '2026-03-01', 4), s, '2026-06-20', '2026-06-20');
  assert.equal(both.items.length, 1);
  assert.equal(both.items[0].source, 'detected');
  // removing it also drops any decision made on it
  const id = s.manual[0].id;
  const gone = removeManual(decide(s, `m:${id}`, 'cancelled'), id);
  assert.deepEqual(gone, emptyRecurring());
});

test('what leaves in the next 30 days is listed in date order', () => {
  const tx = [...monthly('Anthropic', 20, '2026-01-25'), ...monthly('Dropbox', 12, '2026-01-10'), ...monthly('Hulu', 18, '2026-01-02')];
  const s = summarizeRecurring(tx, undefined, '2026-06-26', '2026-06-26');
  assert.deepEqual(s.upcoming.map((u) => [u.merchant, u.date]), [['Hulu', '2026-07-02'], ['Dropbox', '2026-07-10'], ['Anthropic', '2026-07-25']]);
  assert.equal(s.next30Cents, 5000);
});

test('the engine never changes its input', () => {
  const tx = monthly('Anthropic', 20);
  const copy = JSON.stringify(tx);
  const state = decide(undefined, 'anthropic', 'confirmed');
  const before = JSON.stringify(state);
  summarizeRecurring(tx, state, '2026-06-20');
  decide(state, 'anthropic', 'cancelled');
  assert.equal(JSON.stringify(tx), copy);
  assert.equal(JSON.stringify(state), before);
});

test('recurring decisions survive sync: merged key by key, parsed safely, and counted as content', async () => {
  const { mergeOverlays, overlayIsEmpty, parseOverlay } = await import('../src/core/sync');
  const { emptyOverlay } = await import('../src/core/types');
  const a = { ...emptyOverlay(), recurring: decide(addManual(undefined, { merchant: 'Rent', cents: 100000, cadence: 'monthly', anchor: '2026-06-01' }), 'hulu', 'cancelled') };
  const b = { ...emptyOverlay(), recurring: decide(undefined, 'anthropic', 'confirmed') };
  const m = mergeOverlays(a, b).recurring!;
  assert.deepEqual(Object.keys(m.edits).sort(), ['anthropic', 'hulu']);
  assert.equal(m.manual.length, 1);
  assert.ok(!overlayIsEmpty(a) && !overlayIsEmpty(b) && overlayIsEmpty(emptyOverlay()));
  assert.deepEqual(parseOverlay({ recurring: { edits: 5, manual: 'x' } }).recurring, { edits: {}, manual: [] });
  assert.equal(parseOverlay({}).recurring, undefined);
  assert.deepEqual(parseOverlay(JSON.parse(JSON.stringify(a))).recurring, a.recurring);
});
