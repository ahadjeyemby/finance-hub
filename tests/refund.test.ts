import assert from 'node:assert/strict';
import { test } from 'node:test';

import { likelyRefundCredits, receiptToLines, receiptToRow, rowToReceipt } from '../src/core/evidence';
import { acceptReceiptReading, analyseReceipt, diffReceipts, noAnswers, receiptAsText, receiptFieldText, receiptFromRead, receiptMisfits, setReceiptField, settleReceiptReads } from '../src/core/intake';
import type { ReadReceipt } from '../src/core/intake';
import type { Txn } from '../src/core/types';

// An Amazon order printed 2026-08-29: two items, $1.85 tax, $20.24 paid with 2,024 rewards points, $5.59 charged to the card.
// The $17.99 pencil was returned and $19.38 refunded (the pencil plus its share of the tax).
const TODAY = '2026-10-18';
const order: ReadReceipt = {
  kind: 'order_confirmation', merchant: 'Amazon', date: '2026-08-29', order_ref: '111-6451533-8509838', subtotal: 23.98, tax: 1.85, total: 5.59,
  payment_method: 'Amazon Visa', card_last4: '0839', paid_other: 20.24, paid_other_label: '2,024 Amazon Visa rewards points',
  items: [{ item: 'TESEAS Electronic Finger Counter 2 Pack', price: 5.99 }, { item: 'Gnanlen iPad Pencil 2nd Generation', price: 17.99 }],
  refund: { total: 19.38, items: [{ item: 'Gnanlen iPad Pencil 2nd Generation', price: 17.99 }] },
};
const rec = () => receiptFromRead(order, { fileName: 'AMZ-007.pdf' });

test('points paid toward the order are part of the sum, so the order adds up to the card charge', () => {
  const a = analyseReceipt(rec(), noAnswers(), TODAY);
  assert.deepEqual(a.problems, []);
  assert.ok(a.notes.some((n) => /\$20\.24 of this order was paid with 2,024 Amazon Visa rewards points/.test(n)));
});

test('the same order without the points still fails, naming the amount', () => {
  const a = analyseReceipt({ ...rec(), paidOtherCents: undefined }, noAnswers(), TODAY);
  assert.equal(a.problems[0].id, 'sum');
  assert.match(a.problems[0].text, /\$25\.83/);
});

test('the refund is read with its returned items and described without claiming where the money went', () => {
  const r = rec();
  assert.equal(r.refundCents, 1938);
  assert.deepEqual(r.refundedLines?.map((l) => l.cents), [1799]);
  const note = analyseReceipt(r, noAnswers(), TODAY).notes.find((n) => n.startsWith('A refund of $19.38'))!;
  assert.match(note, /does not say whether it went back to the card, to points, or both/);
  assert.match(note, /kept come to \$5\.99 before tax/);
});

test('a refund outside what the returned items and tax allow is flagged', () => {
  const a = analyseReceipt({ ...rec(), refundCents: 2500 }, noAnswers(), TODAY);
  assert.ok(a.problems.some((p) => p.id === 'refund' && /between \$17\.99 and \$19\.84/.test(p.text)));
  const low = analyseReceipt({ ...rec(), refundCents: 1500 }, noAnswers(), TODAY);
  assert.ok(low.problems.some((p) => p.id === 'refund'));
});

test('an order paid partly with points is not split across the card charge', () => {
  assert.deepEqual(receiptToLines(rec(), 559), []);
});

test('points and refund are kept with the stored receipt', () => {
  const raw = receiptToRow(rec(), null, null).raw as Record<string, any>;
  assert.deepEqual(raw.paidOther, { cents: 2024, label: '2,024 Amazon Visa rewards points' });
  assert.equal(raw.refund.totalCents, 1938);
  assert.equal(raw.refund.lines[0].cents, 1799);
});

test('the person can correct the points and refund amounts, and clear them with 0', () => {
  assert.equal(setReceiptField(rec(), 'paidOther', '20.25').record.paidOtherCents, 2025);
  assert.equal(setReceiptField(rec(), 'refundTotal', '0').record.refundCents, undefined);
  assert.ok(setReceiptField(rec(), 'refundTotal', 'abc').error);
});

test('a later credit from the same store, no larger than the refund, is offered as a hint only', () => {
  const t = (id: string, over: Partial<Txn>): Txn => ({ id, accountId: 'c', date: '2026-09-05', description: 'AMAZON.COM*RETURN', merchant: 'Amazon', cents: 1938, kind: 'refund', category: 'shopping', ...over } as Txn);
  const got = likelyRefundCredits(rec(), [t('a', {}), t('b', { cents: 500 }), t('c', { date: '2026-08-01' }), t('d', { cents: 2500 }), t('e', { merchant: 'Target', description: 'TARGET' }), t('f', { kind: 'spend' })]);
  assert.deepEqual(got.map((x) => x.id), ['a', 'b']);
});

// A Burlington receipt prints each item over two rows. Seven items bought ($74.62 + $4.48 tax = $79.10), "SOLD ITEM COUNT = 7".
const burlington = (n: number): ReadReceipt => ({
  merchant: 'Burlington', date: '2026-08-02', subtotal: 74.62, tax: 4.48, total: 79.1, item_count: 7, payment_method: 'MasterCard', card_last4: '9780', store_address: 'DULUTH, GA',
  items: [4.99, 9.99, 5.99, 1.69, 7.99, 24.99, 18.98, 4.99, 9.99, 5.99, 1.69, 7.99, 24.99].slice(0, n).map((price, i) => ({ item: `item ${i + 1}`, price })),
});

test('a receipt that prints its item count is checked against the lines read', () => {
  const good = receiptFromRead(burlington(7), { fileName: 'b.jpg' });
  assert.equal(good.itemCount, 7);
  assert.deepEqual(analyseReceipt(good, noAnswers(), TODAY).problems, []);
  const twoRows = analyseReceipt(receiptFromRead(burlington(13), { fileName: 'b.jpg' }), noAnswers(), TODAY);
  const count = twoRows.problems.find((p) => p.id === 'count')!;
  assert.match(count.text, /prints 7 items sold, but 13 lines were read/);
  assert.ok(twoRows.problems.some((p) => p.id === 'sum'), 'the amounts still disagree too');
});

test('a quantity of two on one line still matches a count of two', () => {
  const r = receiptFromRead({ ...burlington(1), item_count: 2, subtotal: undefined, tax: undefined, total: 4.99, items: [{ item: 'tee', price: 4.99, qty: 2 }] }, { fileName: 'b.jpg' });
  assert.ok(!analyseReceipt(r, noAnswers(), TODAY).problems.some((p) => p.id === 'count'));
});

// What the reader actually returned for the Burlington receipt: prices shifted against their descriptions and one extra line.
const shifted: ReadReceipt = { ...burlington(0), read_by: 'anthropic/claude-haiku-5.5', items: [['TB SS TEE LIC', 4.99], ['3PC SSET JRSY MIN LOGO', 9.99], ['RAZOR 13 REFILL', 5.99], ['2PK GINGHAM BLUEBERRY', 5.99], ['3 SECT 44OZ W UTEN', 1.69], ['HYBRID CAS VULC BTTM', 7.99], ['SANDALS', 24.99], ['SPEEDYMSHOE6', 18.98]].map(([item, price]) => ({ item: item as string, price: price as number })) };
const aligned: ReadReceipt = { ...burlington(0), read_by: 'second-model', items: [['TB SS TEE LIC', 4.99], ['3PC SSET JRSY MIN LOGO', 9.99], ['RAZOR 13 REFILL', 5.99], ['2PK GINGHAM BLUEBERRY', 1.69], ['3 SECT 44OZ W UTEN', 7.99], ['HYBRID CAS VULC BTTM', 24.99], ['SANDALS', 18.98]].map(([item, price]) => ({ item: item as string, price: price as number })) };

test('the shifted reading fails its checks and the aligned one passes', () => {
  assert.equal(receiptMisfits(receiptFromRead(shifted, { fileName: 'b.jpg' })), 3);
  assert.equal(receiptMisfits(receiptFromRead(aligned, { fileName: 'b.jpg' })), 0);
});

test('a second reading that agrees with the printed amounts replaces one that does not, and says so', () => {
  const out = settleReceiptReads(receiptFromRead(shifted, { fileName: 'b.jpg' }), receiptFromRead(aligned, { fileName: 'b.jpg' }));
  assert.deepEqual(out.lines.map((l) => l.cents), [499, 999, 599, 169, 799, 2499, 1898]);
  assert.match(out.corrections![0], /second reading \(second-model\) did/);
  assert.deepEqual(analyseReceipt(out, noAnswers(), TODAY).problems, []);
});

test('when the second reading is no better, the first is kept and nothing is guessed', () => {
  const first = receiptFromRead(shifted, { fileName: 'b.jpg' });
  assert.equal(settleReceiptReads(first, receiptFromRead(shifted, { fileName: 'b.jpg' })), first);
  assert.equal(settleReceiptReads(receiptFromRead(aligned, { fileName: 'b.jpg' }), first).readBy, 'second-model');
});


test('a new reading of a receipt is compared line by line: price changes, a dropped line and a new one are each named, a respelled line is not a change', () => {
  const a = receiptFromRead(shifted, { fileName: 'b.jpg' });
  const b = receiptFromRead({ ...aligned, items: aligned.items!.map((i) => (i.item.startsWith('2PK') ? { ...i, item: '2PK GINGHAM BLUEBERRY FT:WHT/' } : i)) }, { fileName: 'b.jpg' });
  const d = diffReceipts(a, b);
  assert.ok(d.lines.includes('Items read: 8 → 7'));
  assert.ok(d.lines.some((l) => /^2PK GINGHAM BLUEBERRY: \$5\.99 → \$1\.69$/.test(l)));
  assert.ok(d.lines.some((l) => /^3 SECT 44OZ W UTEN: \$1\.69 → \$7\.99$/.test(l)));
  assert.ok(d.lines.some((l) => l.startsWith('Not in the new reading: SPEEDYMSHOE6')));
  assert.equal(d.before, 3);
  assert.equal(d.after, 0);
  assert.deepEqual(diffReceipts(b, b).lines, []);
});

test('accepting a new receipt reading keeps the duplicate answer and notes that it was read again', () => {
  const cur = { ...receiptFromRead(shifted, { fileName: 'b.jpg' }), dup: 'different' as const };
  const out = acceptReceiptReading(cur, receiptFromRead(aligned, { fileName: 'b.jpg' }));
  assert.equal(out.dup, 'different');
  assert.match(out.corrections!.at(-1)!, /Read again at your request \(second-model\)/);
});


// A restaurant receipt: subtotal 48.04, sales tax 3.75% 1.80, service charge 2.0% 0.96, total 50.80, paid by Mastercard 7645.
const diner: ReadReceipt = {
  merchant: 'Diner', date: '2026-07-10', subtotal: 48.04, tax: 1.8, total: 50.8, payment_method: 'MASTERCARD', card_last4: '7645', store_address: 'DULUTH, GA',
  items: [{ item: 'Platter', price: 30.04 }, { item: 'Drinks', price: 18 }],
  charges: [{ label: 'Service Charge (2.0%)', amount: 0.96, rate: 2, type: 'service' }],
};

test('a service charge is kept with its label, rate and type, and counts toward the total', () => {
  const r = receiptFromRead(diner, { fileName: 'd.jpg' });
  assert.deepEqual(r.charges, [{ label: 'Service Charge (2.0%)', cents: 96, rate: 2, type: 'service' }]);
  assert.deepEqual(analyseReceipt(r, noAnswers(), TODAY).problems, []);
  const without = analyseReceipt({ ...r, charges: undefined }, noAnswers(), TODAY);
  assert.equal(without.problems[0].id, 'sum');
  assert.match(without.problems[0].text, /\$50\.80/);
});

test('several different charges are all kept and all add up', () => {
  const r = receiptFromRead({ ...diner, total: 50.8 + 3.99 + 0.1, charges: [...diner.charges!, { label: 'Delivery fee', amount: 3.99, type: 'delivery' }, { label: 'Bag fee', amount: 0.1, type: 'bag' }] }, { fileName: 'd.jpg' });
  assert.equal(r.charges!.length, 3);
  assert.deepEqual(analyseReceipt(r, noAnswers(), TODAY).problems, []);
  assert.match(analyseReceipt({ ...r, charges: r.charges!.slice(0, 1) }, noAnswers(), TODAY).problems[0].text, /plus Service Charge \(2\.0%\) \$0\.96/);
});

test('charges are stored with the receipt, read back, and split out as lines on the charge', () => {
  const r = receiptFromRead(diner, { fileName: 'd.jpg' });
  const row = receiptToRow(r, null, null) as { raw: Record<string, any> };
  assert.equal(row.raw.charges[0].cents, 96);
  assert.equal(rowToReceipt({ ...row, lines: r.lines, raw: row.raw, created_at: 'x' }).charges[0].label, 'Service Charge (2.0%)');
  assert.deepEqual(receiptToLines(r, 5080).map((l) => [l.item, l.cents]), [['Platter', 3004], ['Drinks', 1800], ['Sales tax', 180], ['Service Charge (2.0%)', 96]]);
});

test('the person can edit charges one per line, the reader\'s rate is kept for an unchanged line, and a bad line is refused', () => {
  const r = receiptFromRead(diner, { fileName: 'd.jpg' });
  assert.equal(receiptFieldText(r, 'charges'), 'Service Charge (2.0%) 0.96');
  const same = setReceiptField(r, 'charges', 'Service Charge (2.0%) 0.96\nDelivery fee 3.99').record;
  assert.equal(same.charges![0].rate, 2);
  assert.deepEqual(same.charges!.map((c) => c.cents), [96, 399]);
  assert.ok(setReceiptField(r, 'charges', 'oops').error);
  assert.equal(setReceiptField(r, 'charges', '').record.charges, undefined);
});

test('a receipt whose items plus a charge equal the total is not asked about sales tax', () => {
  const r = receiptFromRead({ ...diner, tax: undefined, total: 48.04 + 0.96 }, { fileName: 'd.jpg' });
  assert.ok(!analyseReceipt(r, noAnswers(), TODAY).gaps.some((g) => g.id === 'tax'));
});


test('the receipt on screen goes back to the reader as numbered lines, with tax, charges and total, so a note can say "item 3"', () => {
  const r = receiptFromRead(diner, { fileName: 'd.jpg' });
  const t = receiptAsText(r).split('\n');
  assert.match(t[0], /store Diner; date 2026-07-10; subtotal \$48\.04; tax \$1\.80; Service Charge \(2\.0%\) \$0\.96; total \$50\.80/);
  assert.equal(t[1], '1. Platter | $30.04');
  assert.equal(t[2], '2. Drinks | $18.00');
});

test('accepting a reading made with a note records the note', () => {
  const out = acceptReceiptReading(receiptFromRead(shifted, { fileName: 'b.jpg' }), receiptFromRead(aligned, { fileName: 'b.jpg' }), 'item 4 is 1.69');
  assert.match(out.corrections!.at(-1)!, /with your note “item 4 is 1\.69”/);
});
