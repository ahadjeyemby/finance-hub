import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordIssues } from '../src/core/income';
import type { IncomeSource, PayRecord } from '../src/core/income';
import { deductionGroup, draftFromRead, provenance } from '../src/core/payslip';
import type { ReadPayslip } from '../src/core/payslip';

// the slip from the screenshot, as a reader would return it (taxes printed with a minus sign come back as they are read)
const read: ReadPayslip = {
  employer: 'Acme Corp', pay_date: '2026-08-14', gross: 3390.42, net: 2283.26,
  earnings: [{ label: 'Regular', amount: 3390.42 }],
  taxes: [{ label: 'Federal Income Tax', amount: -266.31 }, { label: 'Social Security Tax', amount: 178.73 }, { label: 'Medicare Tax', amount: 41.8 }, { label: 'GA State Income Tax', amount: 112.66 }],
  deductions: [{ label: 'Med Pret', amount: 507.66 }],
  deposits: [{ last4: '6659', amount: 1000 }, { last4: 'xxxxxxxx5059', amount: 1283.26 }], read_by: 'anthropic/claude-haiku-5.5',
};
const sources: IncomeSource[] = [{ id: 'job', name: 'Acme Corporation', type: 'salary', words: [] }, { id: 'side', name: 'Consulting', type: 'business', words: [] }];

const toRecord = (d: ReturnType<typeof draftFromRead>): PayRecord => ({
  id: 'x', sourceId: 'job', date: d.date, grossCents: Math.round(Number(d.gross) * 100), netCents: Math.round(Number(d.net) * 100),
  taxes: d.taxes.map((t) => ({ label: t.label, cents: Math.round(Number(t.amount) * 100) })),
  deductions: d.deductions.map((t) => ({ label: t.label, cents: Math.round(Number(t.amount) * 100), group: t.group ?? 'other' })),
  deposits: d.deposits.map((t) => ({ last4: t.last4, cents: Math.round(Number(t.amount) * 100) })),
});

test('a reading becomes form fields: positive amounts, last four digits, the right kind of deduction', () => {
  const d = draftFromRead(read, sources);
  assert.equal(d.gross, '3390.42'); assert.equal(d.net, '2283.26'); assert.equal(d.date, '2026-08-14');
  assert.deepEqual(d.taxes[0], { label: 'Federal Income Tax', amount: '266.31' }, 'the minus sign is dropped');
  assert.equal(d.taxes.length, 4);
  assert.deepEqual(d.deductions, [{ label: 'Med Pret', amount: '507.66', group: 'insurance' }]);
  assert.deepEqual(d.deposits.map((x) => x.last4), ['6659', '5059']);
  assert.equal(d.sourceId, 'job', 'Acme matches one source');
  assert.deepEqual(d.notes, []);
  assert.equal(d.readBy, 'anthropic/claude-haiku-5.5');
});

test('what the reader got is not adjusted: a slip that does not add up shows its gap in the record check', () => {
  assert.deepEqual(recordIssues(toRecord(draftFromRead(read, sources))), []);
  const off = draftFromRead({ ...read, net: 2283.62 }, sources);       // two digits swapped
  assert.equal(off.net, '2283.62');
  assert.equal(recordIssues(toRecord(off)).length, 2);
});

test('missing pieces are said, not invented', () => {
  const d = draftFromRead({ gross: 100, unreadable: 'the bottom half' });
  assert.equal(d.date, ''); assert.equal(d.net, ''); assert.equal(d.sourceId, null);
  assert.ok(d.notes.some((n) => /pay date/.test(n)) && d.notes.some((n) => /Net pay/.test(n)) && d.notes.some((n) => /No taxes/.test(n)) && d.notes.some((n) => /bottom half/.test(n)));
  assert.deepEqual(draftFromRead({}).taxes, []);
  // a bad date or a garbage amount is dropped, not passed on
  const bad = draftFromRead({ pay_date: '14/08/2026', taxes: [{ label: 'x', amount: Number.NaN }, { label: 'y', amount: 5 }] });
  assert.equal(bad.date, ''); assert.deepEqual(bad.taxes, [{ label: 'y', amount: '5.00' }]);
});

test('the source is preselected only when exactly one matches the employer', () => {
  assert.equal(draftFromRead({ ...read, employer: 'Consulting LLC' }, sources).sourceId, 'side');
  assert.equal(draftFromRead({ ...read, employer: 'Unrelated Inc' }, sources).sourceId, null);
  assert.equal(draftFromRead({ ...read, employer: 'Acme Consulting' }, sources).sourceId, null, 'two sources share a word: the person chooses');
  assert.equal(draftFromRead({ ...read, employer: '' }, sources).sourceId, null);
});

test('deductions are sorted by name first, then by the reader guess', () => {
  assert.equal(deductionGroup('Dental Pre-Tax'), 'insurance');
  assert.equal(deductionGroup('401k Employee'), 'retirement');
  assert.equal(deductionGroup('Roth IRA'), 'retirement');
  assert.equal(deductionGroup('Union Dues'), 'other');
  assert.equal(deductionGroup('Mystery', 'retirement'), 'retirement');
  assert.equal(deductionGroup('Mystery', 'bogus'), 'other');
});

test('the note kept on a saved record says how it was made', () => {
  assert.equal(provenance('m', 'slip.png'), 'Read by m from slip.png and checked by hand.');
  assert.equal(provenance(), 'Read and checked by hand.');
});
