import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountNumbers, accountsWithNumber, hasNumber, mergedCoverage, mergedNumbers, parseLast4, unmergedNumbers, whyNotMerge, withNumber, withoutNumber } from '../src/core/accounts';
import { matchReceipt } from '../src/core/evidence';
import { analyseStatement, noAnswers, planStatement, resolveAccount, statementFromRead } from '../src/core/intake';
import { explainUnlinked } from '../src/core/links';
import { linkTrust } from '../src/core/learn';
import { accountToRow, rowToAccount } from '../src/core/sync';
import type { Account, Txn } from '../src/core/types';

// A checking account whose card was reissued: 4152 is the main number, 7788 the replacement debit card.
const checking: Account = { id: 'boa-checking-4152', name: 'Bank of America checking 4152', institution: 'Bank of America', type: 'checking', last4: '4152', coverage: { from: '2026-04-01', to: '2026-06-16' } };
const twoNumbers: Account = withNumber(checking, '7788', 'debit_card');

test('an account answers to its main number and to every number added to it', () => {
  assert.deepEqual(accountNumbers(twoNumbers), ['4152', '7788']);
  assert.ok(hasNumber(twoNumbers, '7788') && hasNumber(twoNumbers, '4152'));
  assert.ok(!hasNumber(twoNumbers, '9999') && !hasNumber(twoNumbers, undefined));
  assert.equal(withNumber(twoNumbers, '7788', 'other'), twoNumbers, 'adding a number it has changes nothing');
  assert.deepEqual(accountNumbers(withoutNumber(twoNumbers, '7788')), ['4152']);
  assert.equal(withoutNumber(twoNumbers, '7788').extraNumbers, undefined);
});

test('digits are read from however the person types them', () => {
  assert.equal(parseLast4('7788'), '7788'); assert.equal(parseLast4('•••• 7788'), '7788'); assert.equal(parseLast4('acct 0001234'), '1234');
  assert.equal(parseLast4('77'), null); assert.equal(parseLast4(''), null);
});

const read = (last4: string) => statementFromRead({ institution: 'Bank of America', last4, account_type: 'checking', period_from: '2026-06-17', period_to: '2026-07-16', opening_balance: 100, closing_balance: 90,
  rows: [{ date: '2026-06-20', description: 'COFFEE', amount: 10, flow: 'out' }] });

test('a statement printed with an added number is the same account, not a new one', () => {
  assert.equal(resolveAccount(read('7788'), [checking]), null);
  assert.equal(resolveAccount(read('7788'), [twoNumbers])?.id, checking.id);
  const a = analyseStatement(read('7788'), { accounts: [twoNumbers], statements: [] }, noAnswers(), '2026-10-18');
  assert.ok(!a.notes.some((n) => /creates a new account/.test(n)));
});

test('choosing "same account" before saving puts the statement under the existing account and keeps the number on it', () => {
  const accounts = accountsWithNumber([checking], checking.id, '7788', 'replaced');
  const plan = planStatement(read('7788'), { accounts, statements: [], existing: [] }, { name: 's.pdf' });
  assert.equal(plan.isNewAccount, false);
  assert.equal(plan.account.id, checking.id);
  assert.deepEqual(plan.account.extraNumbers, [{ last4: '7788', kind: 'replaced' }]);
  assert.equal(plan.account.coverage.from, '2026-04-01');
  assert.equal(plan.account.coverage.to, '2026-07-16');
});

test('extra numbers survive the database round trip, and are not sent when there are none', () => {
  const row = accountToRow(twoNumbers);
  assert.deepEqual(row.extra_numbers, [{ last4: '7788', kind: 'debit_card' }]);
  assert.deepEqual(rowToAccount(row), twoNumbers);
  assert.equal('extra_numbers' in accountToRow(checking), false);
  assert.deepEqual(rowToAccount(accountToRow(checking)), checking);
});

test('a receipt paid with the replacement card is matched to the charge on the account', () => {
  const charge: Txn = { id: 't1', accountId: checking.id, date: '2026-07-13', description: 'SUMDHA INTL', merchant: 'Sumdha Intl Grocery', cents: -3944, kind: 'spend', source: 's' };
  const r = { merchant: 'Suvidha International Market', date: '2026-07-11', totalCents: 3944, cardLast4: '7788', lines: [] };
  assert.equal(matchReceipt(r, [charge], 4, { accounts: [checking] }).likely ?? null, null);
  assert.equal(matchReceipt(r, [charge], 4, { accounts: [twoNumbers] }).likely, 't1');
});

test('a receipt\'s card counts as loaded when it is any number on any account', () => {
  const r = { merchant: 'X', date: '2026-06-01', totalCents: 100, cardLast4: '7788', lines: [] };
  assert.equal(explainUnlinked(r, [], [checking]).why, 'card_not_tracked');
  assert.equal(explainUnlinked(r, [], [twoNumbers]).why, 'no_charge');
});

test('confirmed links count toward an account through any of its numbers', () => {
  const t: Txn = { id: 't1', accountId: checking.id, date: '2026-07-13', description: 'X', merchant: 'X', cents: -100, kind: 'spend', source: 's' };
  const saved = [{ id: 'r1', label: 'x', txnId: 't1', cardLast4: '7788' }];
  assert.equal(linkTrust(saved, [t], [checking]).size, 0);
  assert.equal(linkTrust(saved, [t], [twoNumbers]).get(checking.id), 1);
});


// Two accounts for one real account: a statement with a changed number created the second.
const old: Account = { id: 'boa-checking-4152', name: 'Bank of America checking 4152', institution: 'Bank of America', type: 'checking', last4: '4152', coverage: { from: '2026-04-01', to: '2026-06-16' }, extraNumbers: [{ last4: '5566', kind: 'debit_card' }] };
const fresh: Account = { id: 'boa-checking-7788', name: 'Bank of America checking 7788', institution: 'Bank of America', type: 'checking', last4: '7788', coverage: { from: '2026-06-17', to: '2026-09-15' } };

test('only accounts of one type can be merged, and never the cash account or an account into itself', () => {
  assert.equal(whyNotMerge(old, fresh), null);
  assert.match(whyNotMerge(old, old)!, /two different/);
  assert.match(whyNotMerge(old, { ...fresh, type: 'credit' })!, /checking account cannot be merged into a credit/);
  assert.match(whyNotMerge({ ...old, type: 'cash' }, fresh)!, /cash/);
});

test('merging adds the merged-away account\'s own and extra numbers to the kept account, each once', () => {
  const n = mergedNumbers(fresh, old);
  assert.deepEqual(n, [{ last4: '4152', kind: 'replaced' }, { last4: '5566', kind: 'debit_card' }]);
  assert.deepEqual(mergedNumbers({ ...fresh, extraNumbers: [{ last4: '4152', kind: 'account' }] }, old).map((x) => x.last4), ['4152', '5566']);
  assert.deepEqual(accountNumbers({ last4: fresh.last4, extraNumbers: n }), ['7788', '4152', '5566']);
});

test('undoing a merge takes those numbers away again and keeps the ones that were already there', () => {
  const kept: Account = { ...fresh, extraNumbers: [{ last4: '9999', kind: 'credit_card' }, ...mergedNumbers(fresh, old)] };
  assert.deepEqual(unmergedNumbers(kept, old), [{ last4: '9999', kind: 'credit_card' }]);
});

test('the kept account covers both accounts\' statements', () => {
  assert.deepEqual(mergedCoverage(fresh, old), { from: '2026-04-01', to: '2026-09-15' });
});
