import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allCategories } from '../src/core/categories';
import { dashboardData } from '../src/core/dashboard';
import type { DashboardInput } from '../src/core/dashboard';
import { forecastMonth } from '../src/core/forecast';
import { attribute, emptyIncome, payTotals, payrollTxns, saveRecord, saveSource } from '../src/core/income';
import type { IncomeState, PayRecord } from '../src/core/income';
import { answer, planReport } from '../src/core/report';
import { applyOverlay, runQuery, summarize } from '../src/core/queries';
import { buildQuestions } from '../src/core/questions';
import { fixture } from '../src/dev/fixture';

// The pay slip from the screenshot: gross 3,390.42, taxes 599.50, Med Pret 507.66, take-home 2,283.26.
const slip: PayRecord = {
  id: 'p1', sourceId: 'job', date: '2026-09-15', grossCents: 339042,
  taxes: [{ label: 'Federal Income Tax', cents: 26631 }, { label: 'Social Security Tax', cents: 17873 }, { label: 'Medicare Tax', cents: 4180 }, { label: 'GA State Income Tax', cents: 11266 }],
  deductions: [{ label: 'Med Pret', cents: 50766, group: 'insurance' }], netCents: 228326, deposits: [],
};
const withPay = (): IncomeState => {
  const a = saveSource(emptyIncome(), { id: 'job', name: 'Employer', type: 'salary', words: [] });
  const r = saveRecord(a, slip);
  assert.deepEqual(r.issues, []);
  return r.state;
};
const TAKEN = 59950 + 50766;

function input(income: IncomeState): DashboardInput {
  const f = fixture('full');
  const base = applyOverlay(f.txns, f.overlay);
  const real = f.accounts.filter((a) => a.type !== 'cash');
  return {
    ctx: { txns: [...base, ...payrollTxns(income)].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), accounts: f.accounts, statements: f.statements, recurring: f.overlay.recurring },
    questions: buildQuestions(base, f.overlay), period: '2026-09',
    dataFrom: real.reduce((m, a) => (a.coverage.from < m ? a.coverage.from : m), '9999-99-99'),
    dataTo: real.reduce((m, a) => (a.coverage.to > m ? a.coverage.to : m), '0000-00-00'),
    income, receiptsWaiting: 0,
  };
}

test('a pay record becomes one earned line for what was taken out and one spending line for each tax and deduction', () => {
  const lines = payrollTxns(withPay());
  assert.equal(lines.length, 6);
  const earned = lines.filter((t) => t.kind === 'income');
  assert.equal(earned.length, 1);
  assert.equal(earned[0].cents, TAKEN);
  const spent = lines.filter((t) => t.kind === 'spend');
  assert.equal(spent.reduce((s, t) => s - t.cents, 0), TAKEN);
  assert.deepEqual(spent.map((t) => t.category), ['payroll_tax', 'payroll_tax', 'payroll_tax', 'payroll_tax', 'payroll_insurance']);
  assert.deepEqual(payTotals(lines), { records: 1, grossCents: 339042, netCents: 228326, taxCents: 59950, insuranceCents: 50766, retirementCents: 0, otherCents: 0, takenCents: TAKEN });
});

test('the pay categories are never offered in a picker', () => {
  const ids = allCategories().map((c) => c.id);
  for (const id of ['payroll_tax', 'payroll_insurance', 'retirement', 'payroll_other']) assert.ok(!ids.includes(id));
});

test('earned and spent both grow by what was taken from pay, and left after spending does not change', () => {
  const before = dashboardData(input(emptyIncome()), 'all');
  const after = dashboardData(input(withPay()), 'all');
  assert.equal(after.kpis.earned - before.kpis.earned, TAKEN);
  assert.equal(after.kpis.spent - before.kpis.spent, TAKEN);
  assert.equal(after.kpis.left, before.kpis.left);
  assert.equal(after.cashflow.left, before.cashflow.left);
  assert.equal(after.kpis.pay.takenCents, TAKEN);
  assert.equal(after.kpis.pay.grossCents, 339042);
  assert.equal(before.kpis.pay.records, 0);
});

test('what was taken from pay shows in Where it went and Spending by month, not in the habits and forecasts', () => {
  const before = dashboardData(input(emptyIncome()), 'all');
  const after = dashboardData(input(withPay()), 'all');
  assert.equal(after.donut.slices.find((s) => s.group === 'pay')?.cents, TAKEN);
  assert.equal(after.trend.months.find((m) => m.month === '2026-09')!.byGroup.pay, TAKEN);
  assert.equal(after.donut.total - before.donut.total, TAKEN);
  // nothing that reads habits moves
  assert.deepEqual(after.forecast.forecast, before.forecast.forecast);
  assert.deepEqual(after.forecastBuild, before.forecastBuild);
  assert.deepEqual(after.subscriptions, before.subscriptions);
  assert.deepEqual(after.billsOnce, before.billsOnce);
  assert.deepEqual(after.fixedFlex, before.fixedFlex);
  assert.deepEqual(after.cutIdeas, before.cutIdeas);
  assert.deepEqual(after.oneTime.pending, before.oneTime.pending);
  assert.deepEqual(after.bizPL, before.bizPL);
});

test('the lines belong to their source, and a business source is left out of Household', () => {
  const inc = withPay();
  const lines = payrollTxns(inc);
  const attr = attribute(lines, inc, []);
  assert.equal(attr.get('pay:p1:w'), 'job');
  const biz = saveSource(inc, { id: 'job', name: 'Employer', type: 'business', words: [] });
  const personal = dashboardData(input(biz), 'personal');
  const none = dashboardData(input(emptyIncome()), 'personal');
  assert.equal(personal.kpis.spent, none.kpis.spent);
  assert.equal(personal.kpis.earned, none.kpis.earned);
  const all = dashboardData(input(biz), 'business');
  assert.equal(all.kpis.pay.takenCents, TAKEN);
});

test('queries: spending by category shows the pay lines, gross and take-home count each paycheck once, and forecasts ignore them', () => {
  const income = withPay();
  const ctx = input(income).ctx;
  const byCat = runQuery({ metric: 'spend', groupBy: 'category', filter: { from: '2026-09-01', to: '2026-09-30', categories: ['payroll_tax', 'payroll_insurance'] } }, ctx);
  assert.deepEqual(byCat.rows.map((r) => [r.label, r.value]), [['Taxes taken from pay', 59950], ['Insurance taken from pay', 50766]]);
  assert.equal(runQuery({ metric: 'gross', filter: { from: '2026-09-01', to: '2026-09-30' } }, ctx).total, 339042);
  assert.equal(runQuery({ metric: 'takehome', groupBy: 'month' }, ctx).rows[0].value, 228326);
  const plain = input(emptyIncome()).ctx;
  const s = summarize(ctx, '2026-09-01', '2026-09-30'), s0 = summarize(plain, '2026-09-01', '2026-09-30');
  assert.equal(s.net, s0.net);
  assert.equal(s.pay.takenCents, TAKEN);
  assert.deepEqual(forecastMonth(ctx, '2026-10', '2026-09-30'), forecastMonth(plain, '2026-10', '2026-09-30'));
});

test('a question about pay gets a pay report and an answer from the records', () => {
  const ctx = input(withPay()).ctx;
  const r = planReport('show my paycheck deductions for september', ctx, '2026-10-05');
  assert.match(r.title, /^Pay and deductions/);
  assert.ok(r.blocks.some((b) => b.type === 'kpis' && b.items.some((i) => i.query.metric === 'gross')));
  const a = answer('how much did my paycheck take out in september', ctx, '2026-10-05');
  assert.match(a.text, /gross \$3,390\.42/);
  assert.match(a.text, /\$1,107\.16 taken out/);
  assert.match(a.text, /take-home \$2,283\.26/);
  // insurance means both ways of paying it
  assert.ok(planReport('insurance in september', ctx, '2026-10-05').blocks.some((b) => b.type === 'table' && b.filter?.categories?.includes('payroll_insurance')));
});
