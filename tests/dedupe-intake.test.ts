import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findSameReceipt, keyOf } from '../src/core/dedupe';
import type { ReceiptRecord } from '../src/core/evidence';
import { analyseReceipt, analyseStatement, noAnswers, planStatement, setReceiptField, setStatementField } from '../src/core/intake';
import type { StatementContext, StatementDraft } from '../src/core/intake';
import type { Account, Txn } from '../src/core/types';

const TODAY = '2026-10-17';
const acct: Account = { id: 'bank-checking-1111', name: 'Example Bank checking 1111', institution: 'Example Bank', type: 'checking', last4: '1111', coverage: { from: '2026-05-01', to: '2026-06-30' } };
const row = (id: string, date: string, cents: number, description: string): Txn => ({ id, accountId: acct.id, date, description, merchant: description, cents, kind: cents < 0 ? 'spend' : 'income', source: 'script' });
const draft: StatementDraft = {
  institution: 'Example Bank', last4: '1111', accountType: 'checking', periodFrom: '2026-06-01', periodTo: '2026-06-30', openingCents: 100000, closingCents: 100000 + 250000 - 4200 - 3000,
  rows: [{ date: '2026-06-03', description: 'PAYROLL ACME', cents: 250000 }, { date: '2026-06-10', description: 'Kroger #12', cents: -4200 }, { date: '2026-06-12', description: 'Shell Oil', cents: -3000 }],
};
const base: StatementContext = { accounts: [acct], statements: [] };

// rows as an earlier script or another statement read them: same transactions, different ids
const scripted = [row('s1', '2026-06-03', 250000, 'ACME CORP PAYROLL DES:PAYROLL'), row('s2', '2026-06-10', -4200, 'KROGER #12 ATLANTA GA'), row('s3', '2026-06-12', -3000, 'SHELL OIL 5712')];

test('a statement already in the ledger under other wording adds nothing, and says so', () => {
  const ctx = { ...base, existing: scripted };
  const a = analyseStatement(draft, ctx, noAnswers(), TODAY);
  assert.ok(a.ok, 'strong matches need no decision');
  assert.match(a.notes.join(' '), /3 of 3 rows are already in your ledger under different wording/);
  assert.match(a.notes.join(' '), /Nothing in this statement is new/);
  const plan = planStatement(draft, ctx, { name: 'june.pdf' });
  assert.deepEqual(plan.skipped.map((s) => s.existingId), ['s1', 's2', 's3']);
  assert.equal(plan.txns.length, 0); assert.equal(plan.raw.length, 0);
  assert.ok(plan.statement.reconciled, 'the statement record still reflects every printed row');
  assert.equal(plan.statement.reconciliation && (plan.statement.reconciliation as { rows: number }).rows, 3);
});

test('same date and amount but different wording must be decided, and the decision is honoured', () => {
  const ctx = { ...base, existing: [row('s9', '2026-06-12', -3000, 'POS DEBIT 0612 FUEL')] };
  const a = analyseStatement(draft, ctx, noAnswers(), TODAY);
  assert.deepEqual(a.gaps.map((g) => g.id), ['dupRows']);
  assert.deepEqual(a.gaps[0].options?.map((o) => o.value), ['skip', 'add']);
  assert.ok(!a.ok);

  const skip = setStatementField(draft, 'dupRows', 'skip').draft;
  assert.ok(analyseStatement(skip, ctx, noAnswers(), TODAY).ok);
  const pSkip = planStatement(skip, ctx, { name: 'x.pdf' });
  assert.deepEqual(pSkip.skipped.map((s) => s.existingId), ['s9']); assert.equal(pSkip.txns.length, 2);

  const add = setStatementField(draft, 'dupRows', 'add').draft;
  const pAdd = planStatement(add, ctx, { name: 'x.pdf' });
  assert.equal(pAdd.skipped.length, 0); assert.equal(pAdd.txns.length, 3);
  assert.ok(setStatementField(draft, 'dupRows', 'maybe').error);
});

test('re-reading the same statement updates in place: same ids are rewritten, never skipped or doubled', () => {
  const first = planStatement(draft, { ...base, existing: [] }, { name: 'june.pdf' });
  const again = planStatement(draft, { ...base, existing: first.txns }, { name: 'june.pdf' });
  assert.deepEqual(again.txns.map((t) => t.id), first.txns.map((t) => t.id));
  assert.equal(again.skipped.length, 0);
  const a = analyseStatement(draft, { ...base, existing: first.txns }, noAnswers(), TODAY);
  assert.match(a.notes.join(' '), /3 of 3 rows are already stored exactly as read/);
  assert.match(a.notes.join(' '), /Nothing in this statement is new/);
});

test('two real purchases of one amount on one day are not collapsed when only one is stored', () => {
  const two: StatementDraft = { ...draft, openingCents: 0, closingCents: -6000, rows: [{ date: '2026-06-12', description: 'Shell Oil', cents: -3000 }, { date: '2026-06-12', description: 'Shell Oil', cents: -3000 }] };
  const plan = planStatement(two, { ...base, existing: [row('o', '2026-06-12', -3000, 'SHELL OIL 5712')] }, { name: 'x.pdf' });
  assert.equal(plan.skipped.length, 1); assert.equal(plan.txns.length, 1);
});

test('a new account has nothing to match against', () => {
  const other: StatementDraft = { ...draft, last4: '9999' };
  assert.equal(planStatement(other, { ...base, existing: scripted }, { name: 'x.pdf' }).skipped.length, 0);
});

// ---------- receipts ----------
const photo: ReceiptRecord = { merchant: 'Costco', date: '2026-08-28', time: '14:32', totalCents: 3785, taxCents: 0, paymentMethod: 'Visa', cardLast4: '8840', storeAddress: '1 Main', lines: [{ item: 'gas', cents: 3785 }] };

test('a receipt that is the same purchase as a stored one is noted, not asked', () => {
  const pdf: ReceiptRecord = { ...photo, merchant: 'Costco Wholesale', time: undefined, storeAddress: undefined };
  const same = findSameReceipt(pdf, [keyOf(photo, 'r1', 'September-5.jpg')]);
  assert.equal(same?.level, 'same');
  const a = analyseReceipt({ ...pdf, time: '14:30', storeAddress: '1 Main' }, noAnswers(), TODAY, same);
  assert.ok(a.ok);
  assert.match(a.notes.join(' '), /another document for Costco, 2026-08-28, \$37\.85 \(September-5\.jpg\)/);
});

test('a one-day-apart match must be answered; "different purchase" ends the question', () => {
  const next: ReceiptRecord = { ...photo, date: '2026-08-29' };
  const same = findSameReceipt(next, [keyOf(photo, 'r1', 'a.jpg')]);
  assert.equal(same?.level, 'possible');
  const asked = analyseReceipt(next, noAnswers(), TODAY, same);
  assert.deepEqual(asked.gaps.map((g) => g.id), ['dup']); assert.ok(!asked.ok);
  const extra = setReceiptField(next, 'dup', 'extra').record;
  assert.ok(analyseReceipt(extra, noAnswers(), TODAY, same).ok);
  const diff = setReceiptField(next, 'dup', 'different').record;
  const d = analyseReceipt(diff, noAnswers(), TODAY, same);
  assert.ok(d.ok); assert.deepEqual(d.notes, []);
  assert.ok(setReceiptField(next, 'dup', 'x').error);
  // "different" also overrides a confident match
  assert.deepEqual(analyseReceipt({ ...photo, dup: 'different' }, noAnswers(), TODAY, findSameReceipt(photo, [keyOf(photo, 'r1', 'a.jpg')])).notes, []);
});
