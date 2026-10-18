import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyAnswer, cashToTxn, undoAnswer } from '../src/core/answers';
import { applyOverlay, runQuery, summarize } from '../src/core/queries';
import { buildQuestions, nextCashStep, parseLines } from '../src/core/questions';
import type { CashDraft } from '../src/core/questions';
import { emptyOverlay } from '../src/core/types';
import ledger from '../src/data/seed/ledger.sample.json';

const base = (ledger as any).txns;
const accounts = (ledger as any).accounts;
const view = (o = emptyOverlay()) => { const txns = applyOverlay(base, o); return { txns, accounts }; };

test('seed totals are stable', () => {
  assert.equal(runQuery({ metric: 'spend' }, view()).total, 1575615);
});

test('answering a reimbursement removes the deposit from Earned, undo restores it', () => {
  const o0 = emptyOverlay();
  const q = buildQuestions(view(o0).txns, o0).find((x) => x.type === 'confirm_income')!;
  const earnedBefore = summarize(view(o0), '2026-06-01', '2026-09-30').earned;
  const { overlay } = applyAnswer(q, 'reimbursement', false, o0);
  const earnedAfter = summarize(view(overlay), '2026-06-01', '2026-09-30').earned;
  assert.equal(earnedBefore - earnedAfter, q.cents);
  assert.ok(!buildQuestions(view(overlay).txns, overlay).some((x) => x.id === q.id));
  const restored = undoAnswer(q, overlay);
  assert.equal(summarize(view(restored), '2026-06-01', '2026-09-30').earned, earnedBefore);
});

test('a merchant answer applies to every charge, now and later', () => {
  const o0 = emptyOverlay();
  const q = buildQuestions(view(o0).txns, o0).find((x) => x.type === 'business_or_personal')!;
  const { overlay } = applyAnswer(q, 'business', true, o0);
  const t = view(overlay).txns.filter((x: any) => x.merchant === q.merchant && x.kind === 'spend');
  assert.ok(t.length > 0 && t.every((x: any) => x.business === true));
});

test('business scope and personal scope partition spending', () => {
  const v = view();
  const all = runQuery({ metric: 'spend' }, v).total;
  const biz = runQuery({ metric: 'spend', filter: { scope: 'business' } }, v).total;
  const per = runQuery({ metric: 'spend', filter: { scope: 'personal' } }, v).total;
  assert.equal(biz + per, all);
});

test('cash conversation keeps asking until usable, and items always add up', () => {
  const d: CashDraft = {};
  assert.equal(nextCashStep(d)?.field, 'amount');
  Object.assign(d, { amount: 60 });
  assert.equal(nextCashStep(d)?.field, 'merchant');
  Object.assign(d, { merchant: 'Corner Store', what: 'vegetables and rice', category: 'groceries' });
  assert.equal(nextCashStep(d)?.field, 'lines');
  const { lines, bad } = parseLines('tomatoes 4.50, rice 12, ???');
  assert.deepEqual(bad, ['???']);
  Object.assign(d, { lines, splitAsked: true, date: '2026-10-01', business: false, oneOff: false });
  assert.equal(nextCashStep(d), null);
  const t = cashToTxn(d, '2026-10-16', 1);
  assert.equal(t.cents, -6000);
  assert.equal(t.lines!.reduce((s, l) => s + l.cents, 0), 6000);
  assert.equal(t.lines![t.lines!.length - 1].item, 'Other (not itemised)');
  const over = cashToTxn({ ...d, lines: [{ item: 'a', amount: 70 }] }, '2026-10-16', 2);
  assert.equal(over.lines, undefined);
});
