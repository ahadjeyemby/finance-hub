import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acceptReading, analyseStatement, diffReadings, noAnswers, readingAsText, statementFromRead } from '../src/core/intake';
import type { ReadStatement } from '../src/core/intake';

// A card statement printed for June to July 2026 that the reader dated 2028, so the whole period and every row are a century-style typo away from the document.
const rows = (year: number): ReadStatement['rows'] => [
  { date: `${year}-07-03`, description: 'PAYMENT FROM CHK 5059', amount: 35.1, flow: 'in' },
  { date: `${year}-06-20`, description: 'WM SUPERCENTER #2941', amount: 181.59, flow: 'out' },
  { date: `${year}-06-24`, description: 'HERTZ CAR RENTAL', amount: 386.62, flow: 'out' },
  { date: `${year}-06-25`, description: 'PAYPAL *NAMECHEAP', amount: 11, flow: 'out' },
  { date: `${year}-06-27`, description: 'ALDI 76004', amount: 10.86, flow: 'out' },
];
const read = (year: number, over: Partial<ReadStatement> = {}): ReadStatement => ({
  institution: 'Bank of America', last4: '9780', account_type: 'credit', period_from: `${year}-06-11`, period_to: `${year}-07-10`,
  opening_balance: 35.1, closing_balance: 590.07, rows: rows(year), ...over,
});
const wrong = statementFromRead(read(2028));
const right = statementFromRead(read(2026));

test('a year that moved on every row is reported once, with the period change beside it', () => {
  const d = diffReadings(wrong, right);
  assert.ok(d.lines.includes('Period start: 2028-06-11 → 2026-06-11'));
  assert.ok(d.lines.includes('Period end: 2028-07-10 → 2026-07-10'));
  const dates = d.lines.filter((l) => l.startsWith('Date changed'));
  assert.equal(dates.length, 1);
  assert.match(dates[0], /5 rows|row 1/);
});

test('a reading that says the same thing produces no changes', () => {
  assert.deepEqual(diffReadings(right, statementFromRead(read(2026))).lines, []);
});

test('a changed amount, a dropped row and a new row are each named', () => {
  const other = statementFromRead(read(2026, { rows: [...rows(2026)!.slice(0, 2), { date: '2026-06-24', description: 'HERTZ CAR RENTAL', amount: 387.62, flow: 'out' }, { date: '2026-06-28', description: 'TICKETS AT WORK', amount: 15, flow: 'out' }] }));
  const l = diffReadings(right, other).lines.join('\n');
  assert.match(l, /Row 3 \(HERTZ CAR RENTAL\): \$386\.62 → \$387\.62/);
  assert.match(l, /Row 4 \(2026-06-25 \| PAYPAL \*NAMECHEAP \| \$11\.00 out\) is not in the new reading/);
  assert.match(l, /New reading adds: 2026-06-28 \| TICKETS AT WORK \| \$15\.00 out/);
});

test('the diff reports the balance gap before and after', () => {
  // card: previous 35.10, less the 35.10 payment, plus charges of 590.07, leaves 590.07 owed
  const off = statementFromRead(read(2026, { closing_balance: 591.07 }));
  const d = diffReadings(off, statementFromRead(read(2026)));
  assert.equal(d.gapBefore, 100);
  assert.equal(d.gapAfter, 0);
});

test('the reading goes back to the reader as numbered rows so a note can say "row 3"', () => {
  const t = readingAsText(right).split('\n');
  assert.match(t[0], /period 2026-06-11 to 2026-07-10/);
  assert.equal(t[3], '3. 2026-06-24 | HERTZ CAR RENTAL | $386.62 out');
});

test('accepting a new reading keeps the person’s note and shows it as a correction', () => {
  const out = acceptReading(right, ['the year is 2026']);
  assert.match(out.corrections!.at(-1)!, /the year is 2026/);
  assert.deepEqual((out.raw as { readerNotes: string[] }).readerNotes, ['the year is 2026']);
});

test('a wrong year is still flagged as a future date until a reading replaces it', () => {
  const a = analyseStatement(wrong, { accounts: [], statements: [] }, noAnswers(), '2026-10-17');
  assert.ok(a.problems.some((p) => p.id === 'future'));
  const b = analyseStatement(right, { accounts: [], statements: [] }, noAnswers(), '2026-10-17');
  assert.ok(!b.problems.some((p) => p.id === 'future'));
});
