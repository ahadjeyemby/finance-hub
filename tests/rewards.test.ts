import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyseStatement, noAnswers, planStatement, rowsAddingUpTo, statementFromRead, trailingRowsAddingUpTo } from '../src/core/intake';
import type { ReadStatement } from '../src/core/intake';

// A Chase Amazon Visa statement (fictional figures in the same layout): the card activity foots to the printed balance; a separate
// points table on page 2 lists purchases paid with points, which never reach the card.
const CARD = [
  ['2026-08-13', 'Payment Thank You-Mobile', 150.59, 'in'], ['2026-08-25', 'Payment Thank You-Mobile', 29.58, 'in'], ['2026-08-29', 'Payment Thank You-Mobile', 35.45, 'in'], ['2026-08-31', 'Payment Thank You-Mobile', 37.85, 'in'], ['2026-09-02', 'Payment Thank You-Mobile', 58.86, 'in'],
  ['2026-08-24', 'ALHUDA INT * O #452078 ALHUDAONLINE. TX', 29.58, 'out'], ['2026-08-26', 'Amazon.com*5O5N09UE1 Amzn.com/bill WA', 21.5, 'out'], ['2026-08-26', 'AMAZON MKTPL*5O0EH5K21 Amzn.com/bill WA', 13.95, 'out'], ['2026-08-28', 'COSTCO GAS #0187 DULUTH GA', 37.85, 'out'],
  ['2026-08-31', 'AMAZON MKTPL*5Q7692QA1 Amzn.com/bill WA', 5.59, 'out'], ['2026-08-31', 'AMAZON MKTPL*5Q3F740O2 Amzn.com/bill WA', 8.29, 'out'], ['2026-08-31', 'AMAZON MKTPL*5Q3ET1PD0 Amzn.com/bill WA', 14, 'out'], ['2026-09-01', 'Amazon.com*5Q5TX97T1 Amzn.com/bill WA', 30.98, 'out'],
  ['2026-09-03', 'HEROKU* AUG-113453543 WWW.HEROKU.CO CA', 7, 'out'], ['2026-09-03', 'HEROKU* AUG-113427085 WWW.HEROKU.CO CA', 7, 'out'], ['2026-09-04', 'AMAZON MKTPL*5351S4XZ1 Amzn.com/bill WA', 35.53, 'out'],
] as const;
const POINTS = [
  ['2026-09-03', 'AMAZON MARKETPLACE AMZN.COM/BILLWA', 1.56, 'in', 156], ['2026-08-30', 'AMAZON MARKETPLACE AMZN.COM/BILLWA', 20.24, 'out', 2024], ['2026-08-31', 'AMAZON.COM AMZN.COM/BILLWA', 3.27, 'out', 327], ['2026-09-02', 'AMAZON MARKETPLACE AMZN.COM/BILLWA', 1.56, 'out', 156],
] as const;
const SUMMARY = [['Previous points balance', 1888], ['+ Points transferred from other product', -244], ['+ 5% back on Amazon.com purchases', 155], ['+ 3% back on Amazon.com purchases', 107], ['+ 1% back on all other purchases', 44], ['+ Points adjusted for refund', 156], ['+ Bonus on purchases at gas stations', 114], ['- Points redeemed this statement period', 156]] as const;

const head: ReadStatement = { institution: 'Chase', product: 'Amazon Visa', last4: '0839', account_type: 'credit', period_from: '2026-08-10', period_to: '2026-09-09', opening_balance: 150.59, closing_balance: 49.53 };
const cardRows = (section?: string) => CARD.map(([date, description, amount, flow]) => ({ date, description, amount, flow, section }));
const pointRows = (section?: string) => POINTS.map(([date, description, amount, flow]) => ({ date, description, amount, flow, section }));
const ctx = { accounts: [], statements: [] };
const analyse = (r: ReadStatement) => analyseStatement(statementFromRead(r), ctx, noAnswers(), '2026-10-17');

const reward = {
  summary: SUMMARY.map(([label, points]) => ({ label, points })), points_available: 280,
  activity: POINTS.map(([date, description, amount, flow, points]) => ({ date, description, amount: flow === 'in' ? -amount : amount, points })),
};

test('card activity alone reconciles to the printed balance', () => {
  const a = analyse({ ...head, rows: cardRows() });
  assert.equal(a.ok, true); assert.deepEqual(a.problems, []);
});

test('points lines read as card rows break the balance check, and the message points at them', () => {
  const a = analyse({ ...head, rows: [...cardRows(), ...pointRows()] });
  assert.equal(a.ok, false);
  const text = a.problems.map((p) => p.text).join(' ');
  assert.match(text, /Off by -\$23\.51/);
  assert.match(text, /rows 17, 18, 19 and 20/);
  assert.match(text, /points or rewards lines/);
});

test('rewards reported apart stay out of the rows and are kept with the statement', () => {
  const d = statementFromRead({ ...head, rows: cardRows(), rewards: reward });
  assert.equal(d.rows.length, 16);
  assert.equal(d.rewards?.activity.length, 4);
  assert.equal(d.rewards?.availableForRedemption, 280);
  const a = analyseStatement(d, ctx, noAnswers(), '2026-10-17');
  assert.equal(a.ok, true);
  assert.ok(a.notes.some((n) => /4 rewards lines found \(\$25\.07 paid with points, 2,507 points; \$1\.56 credited back, 156 points returned\)/.test(n)), a.notes.join(' | '));
  assert.ok(a.notes.some((n) => /does not add up: its lines give 2,064 points but it prints 280/.test(n)));
});

test('the same lines listed both as rows and as rewards are counted once, as rewards', () => {
  const d = statementFromRead({ ...head, rows: [...cardRows(), ...pointRows()], rewards: reward });
  assert.equal(d.rows.length, 16);
  assert.equal(d.rewards?.activity.length, 4);
  assert.equal(analyseStatement(d, ctx, noAnswers(), '2026-10-17').ok, true);
});

test('rows under a points-style heading are moved out even when the reader forgot the rewards object', () => {
  const d = statementFromRead({ ...head, rows: [...cardRows('Purchase'), ...pointRows('PURCHASES AND REDEMPTIONS')] });
  assert.equal(d.rows.length, 16);
  assert.deepEqual(d.rewards?.activity.map((l) => [l.section, l.amount]), [['return', -1.56], ['purchase_or_redemption', 20.24], ['purchase_or_redemption', 3.27], ['purchase_or_redemption', 1.56]]);
  assert.equal(analyseStatement(d, ctx, noAnswers(), '2026-10-17').ok, true);
});

test('saving keeps the points table in the same shape the desktop script stores', () => {
  const d = statementFromRead({ ...head, rows: cardRows(), rewards: reward });
  const plan = planStatement(d, { ...ctx, existing: [] }, { name: 'B9BEB57D-list.pdf' });
  assert.equal(plan.txns.length, 16, 'points lines are not transactions');
  assert.equal(plan.statement.reconciled, true);
  const ra = (plan.statement.raw as any).rewardsActivity;
  assert.equal(ra.length, 4);
  assert.deepEqual(ra[1], { section: 'purchase_or_redemption', date: '2026-08-30', description: 'AMAZON MARKETPLACE AMZN.COM/BILLWA', amount: 20.24, points: 2024 });
  assert.equal(ra[0].section, 'return'); assert.equal(ra[0].amount, -1.56);
  assert.equal((plan.statement.terms as any).points.totalAvailableForRedemption, 280);
  assert.equal((plan.statement.terms as any).points.lines['+ 5% back on Amazon.com purchases'], 155);
});

test('statements without rewards are unchanged', () => {
  const d = statementFromRead({ ...head, rows: cardRows() });
  assert.equal(d.rewards, undefined);
  const plan = planStatement(d, { ...ctx, existing: [] }, { name: 'x.pdf' });
  assert.equal((plan.statement.raw as any).rewardsActivity, undefined);
});

test('group search: smallest group only, never a guess between several', () => {
  assert.deepEqual(rowsAddingUpTo([5, 10, 20, 7], 17), [1, 3]);
  assert.deepEqual(trailingRowsAddingUpTo([9, 1, 20, 3, -1, 4], 6), [3, 4, 5], 'the last three rows');
  assert.equal(trailingRowsAddingUpTo([1, 2, 3], 99), null);
  assert.equal(rowsAddingUpTo([1, 2, 3, 4], 5), null, '1+4 and 2+3 both fit');
  assert.equal(rowsAddingUpTo([1, 2], 99), null);
  assert.equal(rowsAddingUpTo(Array.from({ length: 61 }, (_, i) => i + 1), 5), null, 'too many rows to search');
});

test('a plain statement with one digit misread does not blame rows that only add up by coincidence', () => {
  // a Bank of America card statement layout (figures as printed in a real July statement): 45 purchases, one payment, four zero interest lines.
  // The reader returned one amount a dollar short. Several groups of four rows add up to that dollar, and none of them is the cause.
  const buys = [3764.92, 20, 20, 10, 181.59, 26.3, 4.11, 4.78, 41.98, 8.53, 2.76, 386.62, 11, 56.84, 21.82, 0.92, 11.41, 10.86, 15, 19.54, 17, 29.6, 3.86, 14.85, 0.79, 13.93, 266.23, 31.19, 48, 61.37, 25.09, 60.96, 36.85, 3.36, 278, 36.49, 162.38, 62.46, 41.99, 19.99, 20, 150.66, 40.66, 12.08, 23.67];
  const r: ReadStatement = {
    institution: 'Bank of America', product: 'Cash Rewards', last4: '9780', account_type: 'credit', period_from: '2026-06-11', period_to: '2026-07-10', opening_balance: 35.1, closing_balance: 6081.44,
    rows: [
      { date: '2026-07-03', description: 'PAYMENT FROM CHK 5059', amount: 35.1, flow: 'in', section: 'Payments and Other Credits' },
      ...buys.map((amount, i) => ({ date: '2026-06-20', description: `STORE ${i + 1} ATLANTA GA`, amount, flow: 'out' as const, section: 'Purchases and Adjustments' })),
      ...['PURCHASES', 'BALANCE TRANSFERS', 'DIR DEP&CHK CASHADV', 'BANK CASH ADVANCES'].map((d) => ({ date: '2026-07-10', description: `INTEREST CHARGED ON ${d}`, amount: 0, flow: 'out' as const, section: 'Interest Charged' })),
    ],
  };
  const p = analyse(r).problems.find((x) => x.id === 'reconcile')!;
  assert.ok(p, 'the gap is reported');
  assert.match(p.text, /Off by \$1\.00/);
  assert.ok(!/points or rewards/.test(p.text), p.text);
  assert.match(p.text, /one digit misread/);
});
