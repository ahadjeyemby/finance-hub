import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';

import type { ReceiptRecord } from '../src/core/evidence';
import { addRow, analyseReceipt, analyseStatement, flipRow, noAnswers, receiptFieldText, removeRow, statementFieldText, parseDateISO, parseMoneyCents, planStatement, receiptFromRead, resolveAccount, setReceiptField, setStatementField, statementFromRead } from '../src/core/intake';
import type { StatementContext, StatementDraft } from '../src/core/intake';
import { fromBase64, sha256Hex, sniffMime, toBase64 } from '../src/core/sha256';
import type { Account, Txn } from '../src/core/types';

const TODAY = '2026-10-17';

// ---------- fingerprints ----------
test('sha256 and base64 agree with node:crypto and Buffer, including padding boundaries', () => {
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 70000]) {
    const b = new Uint8Array(randomBytes(n));
    assert.equal(sha256Hex(b), createHash('sha256').update(b).digest('hex'), `sha256 of ${n} bytes`);
    assert.equal(toBase64(b), Buffer.from(b).toString('base64'), `base64 of ${n} bytes`);
    assert.deepEqual(Buffer.from(fromBase64(Buffer.from(b).toString('base64'))), Buffer.from(b), `decode of ${n} bytes`);
  }
});

test('file types are read from the bytes, not from what a picker claims', () => {
  assert.equal(sniffMime(new Uint8Array(Buffer.from('%PDF-1.7 rest'))), 'application/pdf');
  assert.equal(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10])), 'image/png');
  assert.equal(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffMime(new Uint8Array(Buffer.from('RIFF1234WEBPVP8 '))), 'image/webp');
  assert.equal(sniffMime(new Uint8Array(Buffer.from('hello world'))), null);
  assert.equal(sniffMime(new Uint8Array(0)), null);
});

// ---------- parsing what people type ----------
test('money and dates are read the way people write them', () => {
  assert.equal(parseMoneyCents('84.19'), 8419);
  assert.equal(parseMoneyCents('$1,084.19'), 108419);
  assert.equal(parseMoneyCents('-12.5'), -1250);
  assert.equal(parseMoneyCents('(12.50)'), -1250);
  assert.equal(parseMoneyCents('abc'), null);
  assert.equal(parseMoneyCents(''), null);
  assert.equal(parseDateISO('2026-08-02'), '2026-08-02');
  assert.equal(parseDateISO('08/02/2026'), '2026-08-02');
  assert.equal(parseDateISO('8/2/26'), '2026-08-02');
  assert.equal(parseDateISO('2026-02-30'), null);
  assert.equal(parseDateISO('13/40/2026'), null);
});

// ---------- receipts ----------
const full: ReceiptRecord = {
  merchant: 'Kroger', date: '2026-10-01', time: '14:32', totalCents: 1080, subtotalCents: 1000, taxCents: 80, paymentMethod: 'Visa credit', cardLast4: '1111', storeAddress: '1 Main St',
  lines: [{ item: 'milk', cents: 450 }, { item: 'rice', cents: 550 }],
};

test('a complete receipt has nothing to ask', () => {
  const a = analyseReceipt(full, noAnswers(), TODAY);
  assert.deepEqual(a.gaps, []); assert.deepEqual(a.problems, []); assert.ok(a.ok);
});

test('an empty receipt asks for every required detail and refuses to be saved', () => {
  const a = analyseReceipt({ lines: [] }, noAnswers(), TODAY);
  const ids = a.gaps.map((g) => g.id);
  for (const id of ['merchant', 'date', 'total', 'lines', 'time', 'paymentMethod', 'storeAddress']) assert.ok(ids.includes(id), `asks for ${id}`);
  assert.ok(!ids.includes('cardLast4'), 'no card digits question when payment is unknown');
  assert.ok(!a.ok);
});

test('"not printed" settles recommended details but never required ones', () => {
  const rec: ReceiptRecord = { ...full, merchant: '', time: undefined, storeAddress: undefined, taxCents: undefined, subtotalCents: undefined, totalCents: 1000 };
  const first = analyseReceipt(rec, noAnswers(), TODAY);
  assert.deepEqual(first.gaps.map((g) => g.id).sort(), ['merchant', 'storeAddress', 'tax', 'time']);
  const skip = analyseReceipt(rec, { notPrinted: ['merchant', 'time', 'storeAddress', 'tax'], acknowledged: [] }, TODAY);
  assert.deepEqual(skip.gaps.map((g) => g.id), ['merchant'], 'the store name can not be skipped');
});

test('card digits are asked only when the payment looks like a card', () => {
  assert.ok(analyseReceipt({ ...full, cardLast4: undefined }, noAnswers(), TODAY).gaps.some((g) => g.id === 'cardLast4'));
  assert.ok(!analyseReceipt({ ...full, cardLast4: undefined, paymentMethod: 'Cash' }, noAnswers(), TODAY).gaps.some((g) => g.id === 'cardLast4'));
});

test('items that do not add up to the total are a problem until fixed or confirmed', () => {
  const rec = { ...full, totalCents: 1500 };
  const a = analyseReceipt(rec, noAnswers(), TODAY);
  assert.deepEqual(a.problems.map((p) => p.id), ['sum']);
  assert.match(a.problems[0].text, /\$10\.00.*\$0\.80.*\$10\.80.*\$15\.00/);
  assert.ok(!a.ok);
  assert.ok(analyseReceipt(rec, { notPrinted: [], acknowledged: ['sum'] }, TODAY).ok, 'confirming keeps it as printed');
  const fixed = setReceiptField(rec, 'total', '10.80').record;
  assert.ok(analyseReceipt(fixed, noAnswers(), TODAY).ok);
});

test('a printed subtotal that disagrees with the items is flagged separately', () => {
  const a = analyseReceipt({ ...full, subtotalCents: 1200 }, noAnswers(), TODAY);
  assert.ok(a.problems.some((p) => p.id === 'subtotal'));
});

test('future dates and bad card digits are flagged', () => {
  assert.ok(analyseReceipt({ ...full, date: '2027-01-01' }, noAnswers(), TODAY).problems.some((p) => p.id === 'future'));
  assert.ok(analyseReceipt({ ...full, cardLast4: '12' }, noAnswers(), TODAY).problems.some((p) => p.id === 'last4'));
});

test('answering a gap with text fills the record and the gap goes away', () => {
  let rec: ReceiptRecord = { lines: [] };
  const steps: [string, string][] = [['merchant', 'Target'], ['date', '09/30/2026'], ['total', '$12.00'], ['lines', 'soap 5.00\nfoam 7.00'], ['tax', '0']];
  for (const [f, v] of steps) { const r = setReceiptField(rec, f, v); assert.equal(r.error, undefined, f); rec = r.record; }
  assert.equal(rec.date, '2026-09-30'); assert.equal(rec.totalCents, 1200); assert.equal(rec.lines.length, 2); assert.equal(rec.taxCents, 0);
  const ids = analyseReceipt(rec, noAnswers(), TODAY).gaps.map((g) => g.id);
  assert.ok(!ids.includes('merchant') && !ids.includes('date') && !ids.includes('total') && !ids.includes('lines') && !ids.includes('tax'));
  assert.ok(setReceiptField(rec, 'date', 'yesterday').error);
  assert.ok(setReceiptField(rec, 'lines', 'just words').error);
});

test('editing items keeps the SKU and quantity the reader found for unchanged lines', () => {
  const rec: ReceiptRecord = { lines: [{ item: 'razor', cents: 599, code: 'AB36352214', qty: 1 }, { item: 'tee', cents: 499 }] };
  const out = setReceiptField(rec, 'lines', 'razor 5.99\ntee 4.00').record;
  assert.equal(out.lines[0].code, 'AB36352214');
  assert.equal(out.lines[1].cents, 400);
});

test('reader output is converted to cents without losing what it returned', () => {
  const r = receiptFromRead({ merchant: ' Costco ', date: '2026-08-28', total: 37.85, tax: 0, card_last4: 'x8840', items: [{ item: 'Fuel', price: 37.85, qty: 1, code: '12' }, { item: '', price: 1 }], other_text: 'member 123' }, { fileName: 'a.jpg', sha256: 'abc' });
  assert.equal(r.merchant, 'Costco'); assert.equal(r.totalCents, 3785); assert.equal(r.taxCents, 0); assert.equal(r.cardLast4, '8840');
  assert.equal(r.lines.length, 1); assert.equal(r.origin, 'app_upload'); assert.equal((r.raw as any).otherText, 'member 123');
});

// ---------- statements ----------
const acctChecking: Account = { id: 'bank-checking-1111', name: 'Example Bank checking 1111', institution: 'Example Bank', type: 'checking', last4: '1111', coverage: { from: '2026-05-01', to: '2026-05-31' } };
const ctx: StatementContext = { accounts: [acctChecking], statements: [] };
const checking: StatementDraft = {
  institution: 'Example Bank', last4: '1111', accountType: 'checking', periodFrom: '2026-06-01', periodTo: '2026-06-30', openingCents: 100000, closingCents: 100000 + 250000 - 4200 - 90000,
  rows: [{ date: '2026-06-03', description: 'PAYROLL ACME', cents: 250000 }, { date: '2026-06-10', description: 'Kroger #12', cents: -4200 }, { date: '2026-06-20', description: 'Payment to Chase card 2222', cents: -90000 }],
};

test('a statement whose rows reconcile to the printed balances has nothing to ask', () => {
  const a = analyseStatement(checking, ctx, noAnswers(), TODAY);
  assert.deepEqual(a.gaps, []); assert.deepEqual(a.problems, []); assert.ok(a.ok);
  assert.deepEqual(a.notes, [], 'existing account, so no new-account note');
});

test('a card statement reconciles from the amount owed: owed + purchases - payments = new balance', () => {
  const card: StatementDraft = { institution: 'Example Bank', last4: '2222', accountType: 'credit', periodFrom: '2026-06-01', periodTo: '2026-06-30', openingCents: 9888, closingCents: 3510,
    rows: [{ date: '2026-06-05', description: 'Store', cents: -8710 }, { date: '2026-06-12', description: 'PAYMENT THANK YOU', cents: 15088 }] };
  const a = analyseStatement(card, ctx, noAnswers(), TODAY);
  assert.deepEqual(a.problems, []);
  assert.match(a.notes.join(), /new account/i, 'unknown card gets a new-account note');
});

test('a missing row is caught by the balance check and named', () => {
  const short = { ...checking, rows: checking.rows.slice(0, 2) };
  const a = analyseStatement(short, ctx, noAnswers(), TODAY);
  const p = a.problems.find((x) => x.id === 'reconcile')!;
  assert.ok(p, 'reconcile problem');
  assert.match(p.text, /Off by -\$900\.00/);
  assert.ok(!a.ok);
});

test('a flipped sign is pointed out', () => {
  const flipped = { ...checking, rows: checking.rows.map((r, i) => (i === 1 ? { ...r, cents: 4200 } : r)) };
  const p = analyseStatement(flipped, ctx, noAnswers(), TODAY).problems.find((x) => x.id === 'reconcile')!;
  assert.match(p.text, /row 2 .*wrong sign/);
});

test('rows missing a date, description or amount each become a question, and answers fill them', () => {
  const broken: StatementDraft = { ...checking, rows: [{ description: 'PAYROLL ACME', cents: 250000 }, { date: '2026-06-10', cents: -4200 }, { date: '2026-06-20', description: 'Payment' }] };
  const a = analyseStatement(broken, ctx, noAnswers(), TODAY);
  assert.deepEqual(a.gaps.map((g) => g.id), ['row.0.date', 'row.1.description', 'row.2.cents']);
  let d = broken;
  for (const [f, v] of [['row.0.date', '6/3/2026'], ['row.1.description', 'Kroger'], ['row.2.cents', '-900.00']] as const) { const r = setStatementField(d, f, v); assert.equal(r.error, undefined); d = r.draft; }
  assert.deepEqual(analyseStatement(d, ctx, noAnswers(), TODAY).gaps, []);
  assert.ok(setStatementField(d, 'row.9.date', '2026-06-01').error);
});

test('missing header details are all asked at once', () => {
  const a = analyseStatement({ rows: [] }, ctx, noAnswers(), TODAY);
  assert.deepEqual(a.gaps.map((g) => g.id), ['institution', 'last4', 'accountType', 'periodFrom', 'periodTo', 'opening', 'closing', 'rows']);
  assert.ok(analyseStatement({ rows: [] }, ctx, { notPrinted: ['rows'], acknowledged: [] }, TODAY).gaps.every((g) => g.id !== 'rows'), 'an empty statement can be confirmed as empty');
});

test('a statement already stored for the same period, or overlapping it, needs a decision', () => {
  const dup = analyseStatement(checking, { ...ctx, accounts: [{ ...acctChecking }], statements: [{ id: 's', accountId: acctChecking.id, periodFrom: '2026-06-01', periodTo: '2026-06-30' }] }, noAnswers(), TODAY);
  assert.deepEqual(dup.problems.map((p) => p.id), ['duplicate']);
  const overlap = analyseStatement(checking, { ...ctx, statements: [{ id: 's', accountId: acctChecking.id, periodFrom: '2026-06-15', periodTo: '2026-07-14' }] }, noAnswers(), TODAY);
  assert.deepEqual(overlap.problems.map((p) => p.id), ['overlap']);
  assert.ok(analyseStatement(checking, { ...ctx, statements: [{ id: 's', accountId: acctChecking.id, periodFrom: '2026-06-01', periodTo: '2026-06-30' }] }, { notPrinted: [], acknowledged: ['duplicate'] }, TODAY).ok);
});

test('rows far outside the period, a truncated read and an account-type clash are flagged', () => {
  const far = { ...checking, rows: [...checking.rows, { date: '2025-06-10', description: 'old', cents: 0 }] };
  assert.ok(analyseStatement(far, ctx, noAnswers(), TODAY).problems.some((p) => p.id === 'outside'));
  assert.ok(analyseStatement({ ...checking, truncated: true }, ctx, noAnswers(), TODAY).problems.some((p) => p.id === 'truncated'));
  assert.ok(analyseStatement({ ...checking, accountType: 'credit' }, ctx, noAnswers(), TODAY).problems.some((p) => p.id === 'type'));
});

test('accounts are matched on last 4 plus a shared institution word', () => {
  assert.equal(resolveAccount({ ...checking, institution: 'EXAMPLE BANK, N.A.' }, [acctChecking])?.id, acctChecking.id);
  assert.equal(resolveAccount({ ...checking, last4: '9999' }, [acctChecking]), null);
  assert.equal(resolveAccount({ ...checking, institution: 'Other Credit Union' }, [acctChecking]), null);
});

test('reader output for a statement: money out becomes negative, balances become cents', () => {
  const d = statementFromRead({ institution: 'Example Bank', last4: '****1111', account_type: 'Checking', period_from: '2026-06-01', period_to: '2026-06-30', opening_balance: 1000, closing_balance: 960.5,
    rows: [{ date: '2026-06-03', description: 'Kroger', amount: 39.5, flow: 'out' }, { date: '2026-06-04', description: 'Refund', amount: 5, flow: 'in' }, { date: '06/05', description: 'no year', amount: 1, flow: 'out' }] });
  assert.equal(d.last4, '1111'); assert.equal(d.accountType, 'checking'); assert.equal(d.openingCents, 100000); assert.equal(d.closingCents, 96050);
  assert.deepEqual(d.rows.map((r) => r.cents), [-3950, 500, -100]);
  assert.equal(d.rows[2].date, undefined, 'a date without a year is not guessed');
  assert.equal(statementFromRead({ account_type: 'Visa credit card' }).accountType, 'credit');
});

test('an approved statement becomes ledger rows with stable ids, the same classifier as the script, and pairs with the other side', () => {
  const existing: Txn[] = [{ id: 'bank-checking-1111:2026-06-20:-90000:payment-to-chase-card-2222', accountId: acctChecking.id, date: '2026-06-20', description: 'Payment to Chase card 2222', merchant: 'Card payment', cents: -90000, kind: 'transfer', subtype: 'card_payment', source: 's' }];
  const card: StatementDraft = { institution: 'Example Bank', last4: '2222', accountType: 'credit', periodFrom: '2026-06-01', periodTo: '2026-06-30', openingCents: 90000, closingCents: 4200,
    rows: [{ date: '2026-06-10', description: 'Kroger #12', cents: -4200 }, { date: '2026-06-21', description: 'PAYMENT THANK YOU', cents: 90000 }] };
  const c2: StatementContext & { existing: Txn[] } = { ...ctx, existing };
  assert.deepEqual(analyseStatement(card, c2, noAnswers(), TODAY).problems, []);
  const plan = planStatement(card, c2, { name: 'june.pdf', sha256: 'f'.repeat(64) });
  assert.equal(plan.isNewAccount, true);
  assert.equal(plan.account.id, 'example-bank-card-2222');
  assert.equal(plan.statement.id, 'example-bank-card-2222:2026-06-01:2026-06-30');
  assert.equal(plan.statement.reconciled, true);
  const pay = plan.txns.find((t) => t.description === 'PAYMENT THANK YOU')!;
  assert.equal(pay.kind, 'transfer'); assert.equal(pay.pairId, existing[0].id);
  assert.deepEqual(plan.pairUpdates, [{ id: existing[0].id, pairId: pay.id }], 'the existing bank row is told about its partner');
  assert.equal(plan.txns.find((t) => t.merchant.toLowerCase().includes('kroger'))?.kind, 'spend');
  assert.equal(plan.raw.length, 2); assert.equal(plan.raw[0].lineNo, 1); assert.equal(plan.raw[0].statementId, plan.statement.id);
  // running it again produces the same ids, so saving twice cannot duplicate rows
  assert.deepEqual(planStatement(card, c2, { name: 'june.pdf' }).txns.map((t) => t.id), plan.txns.map((t) => t.id));
});

test('two identical rows on one statement get distinct ids', () => {
  const d: StatementDraft = { ...checking, openingCents: 0, closingCents: -1000, rows: [{ date: '2026-06-03', description: 'Coffee', cents: -500 }, { date: '2026-06-03', description: 'Coffee', cents: -500 }] };
  const ids = planStatement(d, { ...ctx, existing: [] }, { name: 'x.pdf' }).txns.map((t) => t.id);
  assert.equal(new Set(ids).size, 2);
});

test('an existing account has its coverage widened, not replaced', () => {
  const plan = planStatement(checking, { ...ctx, existing: [] }, { name: 'x.pdf' });
  assert.deepEqual(plan.account.coverage, { from: '2026-05-01', to: '2026-06-30' });
  assert.equal(plan.isNewAccount, false);
});

test('row corrections: flip a sign, remove a duplicate, add a missing row, and the balance check follows', () => {
  const wrong = { ...checking, rows: checking.rows.map((r, i) => (i === 1 ? { ...r, cents: 4200 } : r)) };
  assert.ok(analyseStatement(wrong, ctx, noAnswers(), TODAY).problems.some((p) => p.id === 'reconcile'));
  assert.ok(analyseStatement(flipRow(wrong, 1), ctx, noAnswers(), TODAY).ok, 'flipping the sign fixes it');

  const dup = { ...checking, rows: [...checking.rows, checking.rows[1]] };
  assert.ok(analyseStatement(dup, ctx, noAnswers(), TODAY).problems.some((p) => p.id === 'reconcile'));
  assert.ok(analyseStatement(removeRow(dup, 3), ctx, noAnswers(), TODAY).ok, 'removing the duplicate fixes it');

  const short = { ...checking, rows: checking.rows.slice(0, 2) };
  const added = addRow(short, '6/20/2026', 'Payment to Chase card 2222', '-900');
  assert.equal(added.error, undefined);
  assert.ok(analyseStatement(added.draft, ctx, noAnswers(), TODAY).ok, 'adding the missing row fixes it');
  assert.ok(addRow(short, 'x', 'a', '1').error); assert.ok(addRow(short, '2026-06-01', '', '1').error); assert.ok(addRow(short, '2026-06-01', 'a', 'x').error);
});

test('edit boxes show what is stored, in the form the person would type', () => {
  assert.equal(receiptFieldText(full, 'total'), '10.80'); assert.equal(receiptFieldText(full, 'lines'), 'milk 4.50\nrice 5.50'); assert.equal(receiptFieldText({ lines: [] }, 'tax'), '');
  assert.equal(statementFieldText(checking, 'opening'), '1000.00'); assert.equal(statementFieldText(checking, 'accountType'), 'checking');
});
