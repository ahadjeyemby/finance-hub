import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyseStatement, noAnswers, settleReads, statementFromRead, statementGap } from '../src/core/intake';
import type { ReadStatement } from '../src/core/intake';

// A Bank of America card statement layout (figures as printed in a real July statement): 45 purchases, one payment.
// One reading gets a dollar wrong. The printed balance decides which reading to keep.
const BUYS = [3765.92, 20, 20, 10, 181.59, 26.3, 4.11, 4.78, 41.98, 8.53, 2.76, 386.62, 11, 56.84, 21.82, 0.92, 11.41, 10.86, 15, 19.54, 17, 29.6, 3.86, 14.85, 0.79, 13.93, 266.23, 31.19, 48, 61.37, 25.09, 60.96, 36.85, 3.36, 278, 36.49, 162.38, 62.46, 41.99, 19.99, 20, 150.66, 40.66, 12.08, 23.67];
const read = (amounts: number[], order?: number[]): ReadStatement => {
  const idx = order ?? amounts.map((_, i) => i);
  return {
    institution: 'Bank of America', product: 'Cash Rewards', last4: '9780', account_type: 'credit', period_from: '2026-06-11', period_to: '2026-07-10', opening_balance: 35.1, closing_balance: 6081.44,
    rows: [
      { date: '2026-07-03', description: 'PAYMENT FROM CHK 5059', amount: 35.1, flow: 'in', section: 'Payments and Other Credits' },
      // two rows share a description on one day, as the two Shell lines do
      ...idx.map((i) => ({ date: '2026-06-20', description: i === 6 || i === 7 ? 'SHELL OIL KENNESAW GA' : `STORE ${i + 1} ATLANTA GA`, amount: amounts[i], flow: 'out' as const, section: 'Purchases and Adjustments' })),
    ],
  };
};
const draft = (amounts: number[], order?: number[]) => statementFromRead(read(amounts, order));
const bad = (i: number, v: number) => BUYS.map((x, k) => (k === i ? v : x));
const ctx = { accounts: [], statements: [] };

test('the printed amounts add up, so the balance check has nothing to report', () => {
  assert.equal(statementGap(draft(BUYS)), 0);
});

test('a second reading that adds up replaces a first one that does not', () => {
  const first = draft(bad(0, 3764.92)); const second = draft(BUYS);
  assert.equal(statementGap(first), 100);
  const out = settleReads(first, second);
  assert.equal(statementGap(out), 0);
  assert.match(out.corrections![0], /second reading did/);
});

test('when both readings are wrong in different places, the amount that makes the balance add up is taken from the other reading', () => {
  const first = draft(bad(36, 161.38));            // one dollar short on a Wal-Mart line
  const second = draft(bad(5, 25.3));              // a different line wrong on the second pass
  const out = settleReads(first, second);
  assert.equal(statementGap(out), 0, 'the kept rows now add up');
  assert.equal(out.rows[37].cents, -16238, 'only the row the second reading disagreed on was changed');
  assert.match(out.corrections![0], /Row 38 .* read as \$161\.38 the first time and \$162\.38 the second time/);
});

test('two lines with the same description are not mistaken for a changed amount when the order differs', () => {
  const order = BUYS.map((_, i) => i); [6, 7].forEach((_, k) => { order[6 + k] = 7 - k; });
  const first = draft(bad(0, 3764.92)); const second = draft(BUYS, order);
  const out = settleReads(first, second);
  assert.equal(statementGap(out), 0);
});

test('when neither reading adds up, the rows that differ are named so the person knows where to look', () => {
  const first = draft(bad(36, 161.38));            // the same line wrong on both readings, in two different ways
  const second = draft(bad(36, 160.38));
  const out = settleReads(first, second);
  assert.deepEqual(out.checkRows, [{ index: 37, otherCents: -16038 }]);
  const text = analyseStatement(out, ctx, noAnswers(), '2026-10-17').problems.find((p) => p.id === 'reconcile')!.text;
  assert.match(text, /row 38 .* was read as \$161\.38 and again as \$160\.38, so check it against the PDF first/);
  assert.ok(!/points or rewards/.test(text));
});

test('a statement that already adds up is left alone', () => {
  const first = draft(BUYS);
  assert.equal(settleReads(first, draft(bad(0, 3764.92))), first);
});

test('the review card shows the correction as a note', () => {
  const out = settleReads(draft(bad(36, 161.38)), draft(bad(5, 25.3)));
  const a = analyseStatement(out, ctx, noAnswers(), '2026-10-17');
  assert.ok(!a.problems.some((p) => p.id === 'reconcile'));
  assert.ok(a.notes.some((n) => /makes the statement add up/.test(n)));
});
