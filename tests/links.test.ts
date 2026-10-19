import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rowToRecord } from '../src/core/evidence';
import type { ReceiptRecord } from '../src/core/evidence';
import { applyLinks, explainUnlinked, planLinks } from '../src/core/links';
import type { Link, LinkFlag, StoredReceipt } from '../src/core/links';
import type { Account, Txn } from '../src/core/types';

const accounts: Account[] = [
  { id: 'boa', name: 'BofA card 9780', institution: 'Bank of America', type: 'credit', last4: '9780', coverage: { from: '2026-06-11', to: '2026-08-10' } },
  { id: 'chase', name: 'Chase card 0839', institution: 'Chase', type: 'credit', last4: '0839', coverage: { from: '2026-06-11', to: '2026-08-10' } },
];
const charge = (id: string, date: string, cents: number, merchant: string, accountId = 'boa', over: Partial<Txn> = {}): Txn => ({ id, accountId, date, description: merchant.toUpperCase(), merchant, cents, kind: 'spend', source: 's', ...over });
const rec = (id: string, over: Partial<ReceiptRecord> = {}): StoredReceipt => ({ id, merchant: 'Suvidha International Market', date: '2026-07-11', totalCents: 3944, lines: [], paymentMethod: 'Mastercard', cardLast4: '9780', ...over });
const plan = (receipts: StoredReceipt[], txns: Txn[], links: Link[] = [], flags: LinkFlag[] = []) => planLinks({ receipts, txns, links, flags, accounts });

const sumdha = charge('t1', '2026-07-13', -3944, 'Sumdha Intl Grocery S Suwanee Ga');

test('a receipt whose store name differs from the bank\'s is proposed for the charge on its own card, to be confirmed', () => {
  const p = plan([rec('r1')], [sumdha]);
  assert.equal(p.proposals.length, 1);
  assert.deepEqual([p.proposals[0].receiptId, p.proposals[0].txnId, p.proposals[0].sure], ['r1', 't1', false]);
  assert.match(p.proposals[0].reason, /paid with your card ending 9780/);
  assert.deepEqual(p.chargesWithoutReceipt, []);       // proposed, so not reported as missing a receipt
});

test('a clear match (same store, amount and date) is a sure proposal', () => {
  const p = plan([rec('r1', { merchant: 'Sumdha Grocery' })], [sumdha]);
  assert.deepEqual([p.proposals[0].txnId, p.proposals[0].sure, p.proposals[0].method], ['t1', true, 'store']);
});

test('an order number is the strongest evidence', () => {
  const p = plan([rec('r1', { merchant: 'Amazon', orderRef: '111-1', date: '2026-07-01', totalCents: 999, cardLast4: undefined })], [charge('t9', '2026-07-05', -999, 'AMZN Mktp', 'boa', { ref: '111-1' })]);
  assert.deepEqual([p.proposals[0].txnId, p.proposals[0].method], ['t9', 'order_number']);
});

test('two identical receipts are never both given to one charge: the closer date wins and the other is left with its reason', () => {
  const near = rec('near', { merchant: 'Shell Oil', date: '2026-07-03', totalCents: 3000, cardLast4: undefined });
  const far = rec('far', { merchant: 'Shell Oil', date: '2026-07-01', totalCents: 3000, cardLast4: undefined });
  const p = plan([far, near], [charge('c', '2026-07-03', -3000, 'Shell Oil')]);
  assert.deepEqual(p.proposals.map((x) => [x.receiptId, x.txnId]), [['near', 'c']]);
  assert.equal(p.receiptsWithoutCharge[0].receiptId, 'far');
});

test('two same-amount charges go to two same-amount receipts, one each', () => {
  const a = charge('a', '2026-07-01', -3000, 'Shell Oil'); const b = charge('b', '2026-07-03', -3000, 'Shell Oil');
  const r1 = rec('r1', { merchant: 'Shell Oil', date: '2026-07-01', totalCents: 3000, cardLast4: undefined }); const r2 = rec('r2', { merchant: 'Shell Oil', date: '2026-07-03', totalCents: 3000, cardLast4: undefined });
  const p = plan([r1, r2], [a, b]);
  assert.deepEqual(p.proposals.map((x) => [x.receiptId, x.txnId]).sort(), [['r1', 'a'], ['r2', 'b']]);
});

test('another document for a purchase that already has a receipt becomes an extra link to the same charge', () => {
  const first = rec('r1', { merchant: 'Sumdha Grocery' });
  const second = rec('r2', { merchant: 'Sumdha Grocery', time: undefined });
  const links: Link[] = [{ receiptId: 'r1', txnId: 't1', role: 'primary', method: 'store', confirmed: true }];
  const p = plan([first, second], [sumdha], links);
  assert.deepEqual(p.proposals.map((x) => [x.receiptId, x.txnId, x.role]), [['r2', 't1', 'extra']]);
});

test('a charge that already has its receipt is not offered to another receipt', () => {
  const links: Link[] = [{ receiptId: 'r1', txnId: 't1', role: 'primary', method: 'confirmed', confirmed: true }];
  const p = plan([rec('r1'), rec('r2', { date: '2026-07-12', merchant: 'Other Shop', totalCents: 3944 })], [sumdha], links);
  assert.deepEqual(p.proposals, []);
  assert.equal(p.receiptsWithoutCharge.length, 1);
});

test('a receipt flagged as paid another way is left alone, and a flagged charge is not reported as missing a receipt', () => {
  const flags: LinkFlag[] = [{ kind: 'receipt', refId: 'r1', reason: 'cash' }, { kind: 'txn', refId: 'rent', reason: 'no_receipt' }];
  const p = plan([rec('r1')], [sumdha, charge('rent', '2026-07-01', -150000, 'Landlord')], [], flags);
  assert.deepEqual(p.proposals, []);
  assert.deepEqual(p.receiptsWithoutCharge, []);
  assert.deepEqual(p.chargesWithoutReceipt, ['t1']);     // the Sumdha charge has no receipt and no flag; the rent one is flagged
});

test('hand-entered cash and refunds are not asked to have a receipt', () => {
  const p = plan([], [charge('cash1', '2026-07-01', -500, 'Corner', 'boa', { manual: true }), charge('ref', '2026-07-02', 500, 'Store', 'boa', { kind: 'refund' })]);
  assert.deepEqual(p.chargesWithoutReceipt, []);
});

test('an unlinked receipt says why: no statement for that date, a card that is not loaded, several candidates, or just no such charge', () => {
  const r = rec('r');
  assert.equal(explainUnlinked({ ...r, date: '2026-05-10' }, [], accounts).why, 'outside_statements');
  assert.equal(explainUnlinked({ ...r, cardLast4: '5555' }, [], accounts).why, 'card_not_tracked');
  assert.equal(explainUnlinked(r, [], accounts, ['a', 'b']).why, 'several_charges');
  assert.equal(explainUnlinked(r, [], accounts).why, 'no_charge');
  assert.equal(explainUnlinked({ ...r, date: undefined }, [], accounts).why, 'no_total_or_date');
});

test('the planned list from the plan carries the reason for each unlinked receipt', () => {
  const p = plan([rec('old', { date: '2026-05-10', cardLast4: undefined })], [sumdha]);
  assert.equal(p.receiptsWithoutCharge[0].why, 'outside_statements');
});

test('a charge with a receipt knows it and takes its item lines; a flagged charge says why', () => {
  const receipt = rec('r1', { lines: [{ item: 'milk', cents: 3000 }, { item: 'rice', cents: 800 }], taxCents: 144 });
  const out = applyLinks([sumdha, charge('rent', '2026-07-01', -150000, 'Landlord')], [{ receiptId: 'r1', txnId: 't1', role: 'primary', method: 'confirmed', confirmed: true }], new Map([['r1', receipt]]), [{ kind: 'txn', refId: 'rent', reason: 'no_receipt' }]);
  assert.equal(out[0].receiptId, 'r1');
  assert.deepEqual(out[0].lines!.map((l) => l.item), ['milk', 'rice', 'Sales tax']);
  assert.equal(out[1].receiptFlag, 'no_receipt');
  assert.equal(out[1].receiptId, undefined);
});

test('a charge keeps item lines it already has, and extra links do not become the receipt', () => {
  const t = { ...sumdha, lines: [{ item: 'typed', cents: 3944 }] };
  const receipt = rec('r1', { lines: [{ item: 'milk', cents: 3944 }] });
  assert.deepEqual(applyLinks([t], [{ receiptId: 'r1', txnId: 't1', role: 'primary', method: 'store', confirmed: false }], new Map([['r1', receipt]]))[0].lines, t.lines);
  const extraOnly = applyLinks([sumdha], [{ receiptId: 'r2', txnId: 't1', role: 'extra', method: 'store', confirmed: false }], new Map());
  assert.equal(extraOnly[0].receiptId, 'r2');   // still has a receipt document, so it is not reported as missing one
});

test('a stored receipt row converts back to a record with its charges, points and refund', () => {
  const r = rowToRecord({ id: 'x', merchant: 'Amazon', date: '2026-08-29', total_cents: 559, lines: [{ item: 'a', cents: 599 }], card_last4: '0839', payment_method: 'Amazon Visa', raw: { charges: [{ label: 'Fee', cents: 10 }], paidOther: { cents: 2024, label: 'points' }, refund: { totalCents: 1938, lines: [] } } });
  assert.deepEqual([r.id, r.totalCents, r.cardLast4, r.charges?.[0].cents, r.paidOtherCents, r.refundCents], ['x', 559, '0839', 10, 2024, 1938]);
});
