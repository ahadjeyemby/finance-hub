import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assignDeposit, attribute, emptyIncome, isTaxPayment, matchAll, matchRecord, parseWords, recordIssues, removeRecord, removeSource, saveRecord, saveSource, summarizeIncome } from '../src/core/income';
import type { IncomeSource, PayRecord } from '../src/core/income';
import type { Account, Txn } from '../src/core/types';

const acct = (id: string, last4: string, extra: string[] = []): Account => ({ id, name: id, institution: 'X', type: 'checking', last4, coverage: { from: '2026-01-01', to: '2026-12-31' }, ...(extra.length ? { extraNumbers: extra.map((l) => ({ last4: l })) as Account['extraNumbers'] } : {}) });
const accounts = [acct('chk6659', '6659'), acct('chk5059', '5059')];
let n = 0;
const dep = (accountId: string, date: string, dollars: number, over: Partial<Txn> = {}): Txn => ({ id: `d${n++}`, accountId, date, description: 'DEPOSIT', merchant: 'Deposit', cents: Math.round(dollars * 100), kind: 'income', subtype: 'unconfirmed', source: 's', ...over });
const spend = (date: string, dollars: number, description: string, over: Partial<Txn> = {}): Txn => ({ id: `s${n++}`, accountId: 'chk6659', date, description, merchant: description, cents: -Math.round(dollars * 100), kind: 'spend', source: 's', ...over });

const job: IncomeSource = { id: 'job', name: 'Employer', type: 'salary', words: ['payroll'] };
const side: IncomeSource = { id: 'side', name: 'Consulting', type: 'business', words: ['acme', 'invoice'] };
const slip = (over: Partial<PayRecord> = {}): PayRecord => ({
  id: 'p1', sourceId: 'job', date: '2026-08-14', grossCents: 339042,
  taxes: [{ label: 'Federal Income Tax', cents: 26631 }, { label: 'Social Security Tax', cents: 17873 }, { label: 'Medicare Tax', cents: 4180 }, { label: 'GA State Income Tax', cents: 11266 }],
  deductions: [{ label: 'Med Pret', cents: 50766, group: 'insurance' }], netCents: 228326,
  deposits: [{ last4: '6659', cents: 100000 }, { last4: '5059', cents: 128326 }], ...over,
});

test('the pay slip from the screenshot adds up', () => {
  assert.deepEqual(recordIssues(slip()), []);
});

test('a record that does not add up says by how much, and is never adjusted', () => {
  const bad = slip({ netCents: 228000 });
  const issues = recordIssues(bad);
  assert.equal(issues.length, 2);
  assert.match(issues[0], /\$3390\.42 minus taxes and deductions \$1107\.16 is \$2283\.26, but net pay is \$2280\.00 \(\$3\.26 unaccounted for\)/);
  assert.match(issues[1], /deposits add up to \$2283\.26 but net pay is \$2280\.00/);
  assert.ok(recordIssues(slip({ taxes: [{ label: 'Tax', cents: -5 }] })).some((i) => /more than zero/.test(i)));
  assert.ok(recordIssues(slip({ date: '14/08/2026' })).some((i) => /pay date/.test(i)));
  // deposits are optional
  assert.deepEqual(recordIssues(slip({ deposits: [] })), []);
});

test('each deposit of a split paycheck is found on its own account, near the pay date', () => {
  const a = dep('chk6659', '2026-08-14', 1000), b = dep('chk5059', '2026-08-14', 1283.26);
  const wrongAcct = dep('chk5059', '2026-08-14', 1000);
  const m = matchRecord(slip(), [wrongAcct, a, b], accounts);
  assert.deepEqual(m.map((x) => x.txnId), [a.id, b.id], 'the 1000 on the other account is not the one');
  assert.equal(matchRecord(slip(), [dep('chk6659', '2026-08-20', 1000)], accounts)[0].txnId, null, 'too far from the pay date');
  assert.equal(matchRecord(slip(), [dep('chk6659', '2026-08-17', 1000)], accounts)[0].txnId !== null, true, 'a few days late is fine');
  // a reissued account number still matches
  const moved = [acct('chk6659', '1111', ['6659'])];
  assert.ok(matchRecord(slip(), [dep('chk6659', '2026-08-14', 1000)], moved)[0].txnId);
  // a deposit with no account number on the document matches on amount and date alone
  const open = slip({ deposits: [{ cents: 100000 }] });
  assert.ok(matchRecord(open, [dep('chk5059', '2026-08-15', 1000)], accounts)[0].txnId);
});

test('one deposit is never claimed by two records', () => {
  const only = dep('chk6659', '2026-08-14', 1000);
  const r1 = slip({ id: 'a', deposits: [{ last4: '6659', cents: 100000 }] }), r2 = slip({ id: 'b', date: '2026-08-15', deposits: [{ last4: '6659', cents: 100000 }] });
  const all = matchAll([r1, r2], [only], accounts);
  assert.equal([...all.values()].flat().filter((m) => m.txnId).length, 1);
});

test('deposits get their source from the person, then a record, then the words, and otherwise stay unassigned', () => {
  const byHand = dep('chk6659', '2026-07-01', 50), proven = dep('chk6659', '2026-08-14', 1000), words = dep('chk6659', '2026-07-02', 400, { description: 'ACME CORP INVOICE 22' });
  const payroll = dep('chk6659', '2026-07-03', 900, { description: 'ACME PAYROLL' }), mystery = dep('chk6659', '2026-07-04', 30);
  let st = saveSource(saveSource(undefined, job), side);
  st = saveRecord(st, slip()).state;
  st = assignDeposit(st, byHand.id, 'side');
  const a = attribute([byHand, proven, words, payroll, mystery], st, accounts);
  assert.equal(a.get(byHand.id), 'side');
  assert.equal(a.get(proven.id), 'job', 'named by the pay record');
  assert.equal(a.get(words.id), 'side');
  assert.equal(a.get(payroll.id), 'job', 'when two sources fit, the first in the list wins and the person can reassign');
  assert.equal(a.get(mystery.id), null);
  // an assignment to a removed source is ignored
  assert.equal(attribute([byHand], { ...st, sources: [job] }, accounts).get(byHand.id), null);
});

test('records are saved only when they add up and name a real source', () => {
  const st = saveSource(undefined, job);
  const bad = saveRecord(st, slip({ netCents: 1 }));
  assert.ok(bad.issues.length && bad.state.records.length === 0);
  assert.deepEqual(saveRecord(st, slip({ sourceId: 'nope' })).issues, ['Choose which income source this is.']);
  const ok = saveRecord(st, slip());
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.state.records.length, 1);
  // saving again with the same id replaces it
  assert.equal(saveRecord(ok.state, slip({ note: 'x' })).state.records.length, 1);
  assert.equal(removeRecord(ok.state, 'p1').records.length, 0);
});

test('a source with records cannot be removed; one without can, and its assignments go too', () => {
  let st = saveSource(saveSource(undefined, job), side);
  st = saveRecord(st, slip()).state;
  assert.equal(removeSource(st, 'job'), null);
  st = assignDeposit(st, 'x', 'side');
  const gone = removeSource(st, 'side')!;
  assert.deepEqual(gone.sources.map((s) => s.id), ['job']);
  assert.deepEqual(gone.assign, {});
});

test('the summary gives income by source, taxes withheld, premiums, and how much of the deposits a record proves', () => {
  const d1 = dep('chk6659', '2026-08-14', 1000), d2 = dep('chk5059', '2026-08-14', 1283.26), other = dep('chk6659', '2026-08-20', 500, { description: 'ACME INVOICE 9' }), loose = dep('chk6659', '2026-08-21', 75);
  const old = dep('chk6659', '2026-01-10', 999, { description: 'ACME INVOICE 1' });
  let st = saveSource(saveSource(undefined, job), side);
  st = saveRecord(st, slip()).state;
  const receipts = [{ date: '2026-08-02', taxCents: 312 }, { date: '2026-08-09', taxCents: 0 }, { date: '2026-08-10', taxCents: 188 }, { date: '2026-02-02', taxCents: 999 }, { date: null, taxCents: 50 }];
  const irs = spend('2026-08-12', 400, 'IRS USATAXPYMT EST'), dmv = spend('2026-08-13', 90, 'GA DMV FEE');
  const s = summarizeIncome([d1, d2, other, loose, old, irs, dmv], accounts, st, { from: '2026-08-01', to: '2026-08-31' }, receipts);
  assert.equal(s.totalCents, 100000 + 128326 + 50000 + 7500);
  const j = s.sources.find((x) => x.source?.id === 'job')!;
  assert.equal(j.depositsCents, 228326);
  assert.equal(j.provenCents, 228326);
  assert.equal(j.grossCents, 339042);
  assert.equal(j.taxCents, 59950);
  assert.ok(Math.abs(j.taxRate! - 59950 / 339042) < 1e-12);
  assert.equal(s.sources.find((x) => x.source?.id === 'side')!.depositsCents, 50000);
  assert.deepEqual(s.unassigned.map((t) => t.id), [loose.id]);
  assert.equal(s.sources[s.sources.length - 1].source, null, 'the unassigned row comes last');
  assert.equal(s.withheldCents, 59950);
  assert.deepEqual(s.withheld[0], { label: 'Federal Income Tax', cents: 26631 });
  assert.equal(s.insuranceCents, 50766);
  assert.equal(s.paid.cents, 40000, 'only the tax payment, not the DMV fee');
  assert.equal(s.salesTaxCents, 500);
  assert.equal(s.salesTaxReceipts, 2);
  // the January invoice is outside this period
  assert.equal(summarizeIncome([old], accounts, st, { from: '2026-08-01', to: '2026-08-31' }).totalCents, 0);
});

test('with nothing set up the deposits are all unassigned and nothing breaks', () => {
  const d = dep('chk6659', '2026-08-14', 10);
  const s = summarizeIncome([d], accounts, undefined, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(s.totalCents, 1000);
  assert.equal(s.unassigned.length, 1);
  assert.equal(s.withheldCents, 0);
  assert.equal(s.sources[0].source, null);
});

test('tax payments are told apart from other government fees, and words are parsed', () => {
  assert.ok(isTaxPayment(spend('2026-08-01', 10, 'IRS TREAS 310 TAX REF')) && isTaxPayment(spend('2026-08-01', 10, 'GA DEPT OF REVENUE')) && isTaxPayment(spend('2026-08-01', 10, 'FULTON COUNTY PROPERTY TAX')));
  assert.ok(!isTaxPayment(spend('2026-08-01', 10, 'GA DMV FEE')) && !isTaxPayment(dep('chk6659', '2026-08-01', 10, { description: 'IRS TREAS REFUND' })));
  assert.deepEqual(parseWords('Acme, invoice\n ACME ,'), ['acme', 'invoice']);
  assert.deepEqual(emptyIncome(), { sources: [], records: [], assign: {} });
});

test('the engine never changes its input', () => {
  const st = saveSource(undefined, job);
  const before = JSON.stringify(st);
  saveRecord(st, slip()); assignDeposit(st, 'x', 'job'); removeSource(st, 'job'); saveSource(st, side);
  assert.equal(JSON.stringify(st), before);
});

test('income setup survives sync: merged by id, parsed safely, and counted as content', async () => {
  const { mergeOverlays, overlayIsEmpty, parseOverlay } = await import('../src/core/sync');
  const { emptyOverlay } = await import('../src/core/types');
  const a = { ...emptyOverlay(), income: saveRecord(saveSource(undefined, job), slip()).state };
  const b = { ...emptyOverlay(), income: assignDeposit(saveSource(undefined, side), 'x', 'side') };
  const m = mergeOverlays(a, b).income!;
  assert.deepEqual(m.sources.map((x) => x.id).sort(), ['job', 'side']);
  assert.equal(m.records.length, 1);
  assert.deepEqual(m.assign, { x: 'side' });
  assert.ok(!overlayIsEmpty(a) && !overlayIsEmpty(b) && overlayIsEmpty(emptyOverlay()));
  assert.deepEqual(parseOverlay({ income: { sources: 4, records: 'x', assign: [] } }).income, { sources: [], records: [], assign: {} });
  assert.equal(parseOverlay({}).income, undefined);
  assert.deepEqual(parseOverlay(JSON.parse(JSON.stringify(a))).income, a.income);
});
