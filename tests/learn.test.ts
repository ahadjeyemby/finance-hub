import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ReceiptKey } from '../src/core/dedupe';
import { matchReceipt } from '../src/core/evidence';
import type { ReceiptRecord } from '../src/core/evidence';
import { AUTO_AFTER, applyCardHabit, learnAliases, learnCard, linkTrust, methodKey } from '../src/core/learn';
import type { Account, Txn } from '../src/core/types';

const card = (m: string, last4: string, n = 1): ReceiptKey[] => Array.from({ length: n }, (_, i) => ({ id: `${m}${last4}${i}`, label: 'x', paymentMethod: m, cardLast4: last4 }));
const rec = (over: Partial<ReceiptRecord> = {}): ReceiptRecord => ({ merchant: 'Suvidha International Market', date: '2026-07-11', totalCents: 3944, lines: [], paymentMethod: 'Mastercard (credit card)', ...over });

test('different spellings of one card brand count as the same payment method', () => {
  assert.equal(methodKey('MASTERCARD CREDIT TEND'), 'mastercard');
  assert.equal(methodKey('Mastercard (credit card)'), 'mastercard');
  assert.equal(methodKey('WMP MCARD TEND (Walmart Pay)'), 'mastercard');
  assert.equal(methodKey('Amazon Visa'), 'visa');
  assert.equal(methodKey('Cash'), null);
  assert.equal(methodKey(undefined), null);
});

test('card digits are proposed from earlier receipts, and filled in without asking only after five confirmations', () => {
  assert.equal(learnCard([], 'Mastercard'), null);
  const few = learnCard(card('MASTERCARD CREDIT TEND', '9780', AUTO_AFTER - 1), 'Mastercard (credit card)')!;
  assert.deepEqual([few.value, few.count, few.auto], ['9780', AUTO_AFTER - 1, false]);
  const enough = learnCard(card('MASTERCARD CREDIT TEND', '9780', AUTO_AFTER), 'Mastercard (credit card)')!;
  assert.equal(enough.auto, true);
  assert.equal(applyCardHabit(rec(), card('Mastercard', '9780', AUTO_AFTER)).cardLast4, '9780');
  assert.match(applyCardHabit(rec(), card('Mastercard', '9780', AUTO_AFTER)).corrections![0], /filled in from your 5 earlier mastercard receipts/);
  assert.equal(applyCardHabit(rec(), card('Mastercard', '9780', AUTO_AFTER - 1)).cardLast4, undefined);
});

test('two cards of one brand are never filled in unasked, and both are offered', () => {
  const both = [...card('Mastercard', '9780', 6), ...card('Mastercard', '7645', 3)];
  const h = learnCard(both, 'Mastercard')!;
  assert.equal(h.value, '9780'); assert.equal(h.auto, false);
  assert.deepEqual(h.others, [{ value: '7645', count: 3 }]);
  assert.equal(applyCardHabit(rec(), both).cardLast4, undefined);
});

test('printed card digits and other brands are left alone', () => {
  assert.equal(applyCardHabit(rec({ cardLast4: '1111' }), card('Mastercard', '9780', 9)).cardLast4, '1111');
  assert.equal(applyCardHabit(rec({ paymentMethod: 'Visa' }), card('Mastercard', '9780', 9)).cardLast4, undefined);
  assert.equal(applyCardHabit(rec({ paymentMethod: undefined }), card('Mastercard', '9780', 9)).cardLast4, undefined);
});

// the case from the screen: receipt "Suvidha International Market" 07-11 $39.44 on card 9780; the bank printed "Sumdha Intl Grocery S Suwanee Ga" on 07-13
const accounts: Account[] = [{ id: 'boa', name: 'BofA card 9780', institution: 'Bank of America', type: 'credit', last4: '9780', coverage: { from: '2026-06-11', to: '2026-07-10' } }, { id: 'chase', name: 'Chase card 0839', institution: 'Chase', type: 'credit', last4: '0839', coverage: { from: '2026-06-11', to: '2026-07-10' } }];
const charge = (id: string, date: string, cents: number, merchant: string, accountId = 'boa'): Txn => ({ id, accountId, date, description: merchant.toUpperCase(), merchant, cents, kind: 'spend', source: 's' });
const sumdha = charge('t1', '2026-07-13', -3944, 'Sumdha Intl Grocery S Suwanee Ga');

test('same amount and date on the receipt\'s own card is proposed as a likely match when the store names differ', () => {
  const r = rec({ cardLast4: '9780' });
  assert.equal(matchReceipt(r, [sumdha]).txnId, null);                                   // without the card there is only a candidate
  const m = matchReceipt(r, [sumdha], 4, { accounts });
  assert.equal(m.txnId, null); assert.equal(m.likely, 't1');
  assert.match(m.reason, /same amount, 2 days apart, paid with your card ending 9780/);
});

test('a likely match is linked outright once that card has enough confirmed links', () => {
  const m = matchReceipt(rec({ cardLast4: '9780' }), [sumdha], 4, { accounts, trusted: (id) => id === 'boa' });
  assert.equal(m.txnId, 't1');
  assert.equal(matchReceipt(rec({ cardLast4: '9780' }), [sumdha], 4, { accounts, trusted: () => false }).txnId, null);
});

test('a charge on a different card is not proposed', () => {
  const other = charge('t2', '2026-07-13', -3944, 'Sumdha Intl Grocery', 'chase');
  const m = matchReceipt(rec({ cardLast4: '9780' }), [other], 4, { accounts });
  assert.equal(m.likely ?? null, null);
  assert.equal(m.txnId, null);
});

test('a store-name pair the person confirmed once makes the next receipt link by itself', () => {
  const saved: ReceiptKey[] = [{ id: 'r1', label: 'x', merchant: 'Suvidha International Market', txnId: 't1', cardLast4: '9780' }];
  const aliases = learnAliases(saved, [sumdha]);
  const next = charge('t9', '2026-08-02', -2210, 'Sumdha Intl Grocery S Suwanee Ga');
  const m = matchReceipt(rec({ date: '2026-08-01', totalCents: 2210 }), [next], 4, { aliases });
  assert.equal(m.txnId, 't9');
  assert.equal(matchReceipt(rec({ date: '2026-08-01', totalCents: 2210 }), [next]).txnId, null);
});

test('two same-amount charges are told apart by the receipt\'s card', () => {
  const a = charge('a', '2026-07-12', -3944, 'Suvidha Market', 'boa'); const b = charge('b', '2026-07-12', -3944, 'Suvidha Market', 'chase');
  assert.equal(matchReceipt(rec({ cardLast4: '9780' }), [a, b], 4, { accounts }).txnId, 'a');
  assert.equal(matchReceipt(rec(), [a, b], 4, { accounts }).txnId, null);
});

test('confirmed links are counted per card, and only when the receipt\'s card is the charge\'s card', () => {
  const txns = [sumdha, charge('t2', '2026-07-14', -500, 'Shop', 'chase')];
  const saved: ReceiptKey[] = [
    { id: 'r1', label: 'x', txnId: 't1', cardLast4: '9780' }, { id: 'r2', label: 'x', txnId: 't1', cardLast4: '9780' },
    { id: 'r3', label: 'x', txnId: 't2', cardLast4: '9780' },       // receipt says 9780 but the charge is on the Chase card: not a confirmation of 9780
    { id: 'r4', label: 'x', txnId: null, cardLast4: '9780' },
  ];
  assert.deepEqual([...linkTrust(saved, txns, accounts)], [['boa', 2]]);
});
