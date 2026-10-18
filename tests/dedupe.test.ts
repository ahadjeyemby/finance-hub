import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findSameReceipt, findTwins, keyOf, likelyCharges, nameWords, sharesStore } from '../src/core/dedupe';
import type { ReceiptRecord } from '../src/core/evidence';
import type { Txn } from '../src/core/types';

const tx = (id: string, date: string, cents: number, merchant: string, over: Partial<Txn> = {}): Txn => ({ id, accountId: 'chk', date, description: merchant, merchant, cents, kind: 'spend', source: 's', ...over } as Txn);
const rec = (over: Partial<ReceiptRecord> = {}): ReceiptRecord => ({ merchant: 'Costco', date: '2026-08-28', totalCents: 3785, lines: [], ...over });
const stored = (r: ReceiptRecord, id = 'r1') => keyOf(r, id, `${id}.jpg`);

test('store names: shared distinctive word, never on unknown', () => {
  assert.deepEqual(nameWords('SAMS CLUB #6409'), ['sams', 'club']);
  assert.ok(sharesStore('Costco Wholesale', 'COSTCO #118') && sharesStore("Sam's Club", 'SAMS CLUB 6409'));
  assert.ok(!sharesStore('Costco', 'Kroger') && !sharesStore('', 'Costco') && !sharesStore(undefined, undefined));
  assert.ok(!sharesStore('The Store', 'Store Inc'), 'filler words alone are not a store');
});

test('paper receipt and e-receipt of one purchase are the same purchase', () => {
  const photo = rec({ time: '14:32', cardLast4: '1111' });
  const pdf = rec({ merchant: 'Costco Wholesale', time: '2:32 PM', cardLast4: '1111', orderRef: undefined });
  const s = findSameReceipt(pdf, [stored(photo)]);
  assert.equal(s?.level, 'same'); assert.equal(s?.of.id, 'r1');
  // one side missing a time or card is still the same: nothing contradicts it
  assert.equal(findSameReceipt(rec(), [stored(photo)])?.level, 'same');
});

test('what rules a match out: another total, store, time, card or store number', () => {
  const base = rec({ time: '09:00', cardLast4: '1111', storeRef: '118' });
  assert.equal(findSameReceipt(rec({ totalCents: 3786 + 1 }), [stored(base)]), null);
  assert.equal(findSameReceipt(rec({ merchant: 'Kroger' }), [stored(base)]), null);
  assert.equal(findSameReceipt(rec({ time: '16:45' }), [stored(base)]), null, 'two $37.85 trips at different times');
  assert.equal(findSameReceipt(rec({ cardLast4: '2222' }), [stored(base)]), null);
  assert.equal(findSameReceipt(rec({ storeRef: '200' }), [stored(base)]), null);
  assert.equal(findSameReceipt(rec({ totalCents: undefined }), [stored(base)]), null);
  assert.equal(findSameReceipt(rec({ date: '2026-08-20' }), [stored(base)]), null, 'a week apart is another purchase');
});

test('one cent of rounding is tolerated; a day apart is only possible', () => {
  assert.equal(findSameReceipt(rec({ totalCents: 3786 }), [stored(rec())])?.level, 'same');
  const next = findSameReceipt(rec({ date: '2026-08-29' }), [stored(rec())]);
  assert.equal(next?.level, 'possible');
  // a same-day match elsewhere in the list beats an earlier "possible"
  assert.equal(findSameReceipt(rec(), [stored(rec({ date: '2026-08-27' }), 'a'), stored(rec(), 'b')])?.of.id, 'b');
});

test('order number plus total matches across different store names; same order, different total does not', () => {
  const a = rec({ merchant: 'Amazon', orderRef: '111-0363052-1325069', date: '2026-07-01', totalCents: 2260 });
  const b = rec({ merchant: 'AMZN Mktp US', orderRef: '111-0363052-1325069', date: '2026-07-03', totalCents: 2260 });
  assert.equal(findSameReceipt(b, [stored(a)])?.why, 'same order number and total');
  assert.equal(findSameReceipt({ ...b, totalCents: 1500 }, [stored(a)]), null, 'a second shipment of one order is its own charge');
});

test('charges that could be this purchase', () => {
  const led = [tx('a', '2026-08-28', -3785, 'Costco Whse #118'), tx('b', '2026-08-29', -3785, 'Target'), tx('c', '2026-08-28', -3785, 'Unknown', { accountId: 'cash', manual: true }), tx('d', '2026-08-28', 3785, 'Costco refund', { kind: 'income' })];
  assert.deepEqual(likelyCharges({ merchant: 'Costco', date: '2026-08-28', totalCents: 3785 }, led).map((t) => t.id), ['a', 'c']);
  // another day: only the store name can vouch for it
  assert.deepEqual(likelyCharges({ merchant: 'Costco', date: '2026-08-30', totalCents: 3785 }, led).map((t) => t.id), ['a']);
  assert.deepEqual(likelyCharges({ merchant: 'Costco', date: '2026-08-28', totalCents: 3000 }, led), []);
  assert.deepEqual(likelyCharges({ merchant: 'Costco', date: '2026-09-10', totalCents: 3785 }, led), []);
  assert.deepEqual(likelyCharges({ merchant: 'Costco' }, led), []);
});

test('statement rows: same id, same transaction read differently, and genuine repeats', () => {
  const have = [tx('chk:2026-06-10:-4200:kroger-12', '2026-06-10', -4200, 'KROGER #12 ATLANTA GA'), tx('chk:2026-06-12:-3000:shell-oil', '2026-06-12', -3000, 'SHELL OIL 5712'), tx('x', '2026-06-20', -999, 'Other', { accountId: 'other' })];
  const rows = [
    { date: '2026-06-10', description: 'Kroger #12', cents: -4200 },                   // other wording of a stored row
    { date: '2026-06-12', description: 'Shell Oil', cents: -3000 },                    // would get the stored id
    { date: '2026-06-12', description: 'Shell Oil', cents: -3000 },                    // a second identical purchase: not stored yet
    { date: '2026-06-20', description: 'Pharmacy', cents: -999 },                      // same amount and day, but in another account
  ];
  const ids = ['chk:2026-06-10:-4200:kroger-12', 'chk:2026-06-12:-3000:shell-oil', 'chk:2026-06-12:-3000:shell-oil#2', 'chk:2026-06-20:-999:pharmacy'];
  const tw = findTwins(rows, ids, have, 'chk');
  assert.deepEqual(tw.map((t) => [t.index, t.existingId, t.sameId, t.strong]), [[0, 'chk:2026-06-10:-4200:kroger-12', true, true], [1, 'chk:2026-06-12:-3000:shell-oil', true, true]]);
  // the same rows from a source whose ids differ: wording decides strong or weak
  const other = findTwins(rows, ['n0', 'n1', 'n2', 'n3'], have, 'chk');
  assert.deepEqual(other.map((t) => [t.index, t.sameId, t.strong]), [[0, false, true], [1, false, true]]);
  const weak = findTwins([{ date: '2026-06-12', description: 'POS DEBIT 0612 FUEL', cents: -3000 }], ['z'], have, 'chk');
  assert.deepEqual(weak.map((t) => [t.sameId, t.strong]), [[false, false]]);
});

test('rows without a date or amount are never twins', () => {
  assert.deepEqual(findTwins([{ description: 'x', cents: -100 }, { date: '2026-06-10' }], ['a', 'b'], [tx('q', '2026-06-10', -100, 'x')], 'chk'), []);
});
