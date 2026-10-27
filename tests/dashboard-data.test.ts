import assert from 'node:assert/strict';
import { test } from 'node:test';

import { unmatchedCardPayments } from '../src/core/accounts';
import { applyAnswer } from '../src/core/answers';
import { completeMonths, coveredDays, gaps, intervalsFor } from '../src/core/coverage';
import { dashboardData } from '../src/core/dashboard';
import type { DashboardInput, Scope } from '../src/core/dashboard';
import { forecastMonth } from '../src/core/forecast';
import { emptyIncome } from '../src/core/income';
import { bestStore, compareItems, usualBasket } from '../src/core/prices';
import { applyOverlay } from '../src/core/queries';
import { buildQuestions, uniqueCents } from '../src/core/questions';
import { addManual, summarizeRecurring } from '../src/core/recurring';
import type { Account, Overlay, Txn } from '../src/core/types';
import { fixture } from '../src/dev/fixture';
import type { FixtureKind } from '../src/dev/fixture';

/** The dashboard's input for a fictional fixture, with the person's overlay applied (as the app does). */
function inputFor(kind: FixtureKind, over: { overlay?: Overlay; period?: string; txns?: Txn[] } = {}): DashboardInput {
  const f = fixture(kind);
  const overlay = over.overlay ?? f.overlay;
  const txns = applyOverlay(over.txns ?? f.txns, overlay);
  const real = f.accounts.filter((a) => a.type !== 'cash');
  return {
    ctx: { txns, accounts: f.accounts, statements: f.statements, recurring: overlay.recurring },
    questions: buildQuestions(txns, overlay), period: over.period ?? '2026-09',
    dataFrom: real.reduce((m, a) => (a.coverage.from < m ? a.coverage.from : m), '9999-99-99'),
    dataTo: real.reduce((m, a) => (a.coverage.to > m ? a.coverage.to : m), '0000-00-00'),
    income: overlay.income ?? emptyIncome(), receiptsWaiting: 0,
  };
}
const data = (kind: FixtureKind, scope: Scope = 'all', over: Parameters<typeof inputFor>[1] = {}) => dashboardData(inputFor(kind, over), scope);

// ---- readiness -------------------------------------------------------------------------------------------------------------------------

test('with no accounts at all, every widget is locked and says what unlocks it', () => {
  const d = dashboardData({ ...inputFor('none'), dataFrom: '2026-10-22', dataTo: '2026-10-22' }, 'all');
  for (const [id, w] of Object.entries(d)) {
    assert.equal(w.readiness, 'data', id);
    assert.ok(w.lock?.missing && w.lock.action.label, `${id} names what is missing and one action`);
  }
});

test('the full fixture: widgets are ready, or need answers that come from real open questions', () => {
  const d = data('full');
  for (const id of ['donut', 'trend', 'grocery', 'fuel', 'pace', 'attention'] as const) assert.equal(d[id].readiness, 'ready', id);
  assert.equal(d.subscriptions.readiness, 'answers', 'bills the app found but nobody confirmed (answered on the Recurring screen)');
  assert.equal(d.kpis.readiness, 'answers', 'an unconfirmed deposit in September');
  assert.ok(d.kpis.ask!.questionIds.every((id) => id.startsWith('income:')));
  assert.equal(d.bizPending.readiness, 'answers');
  assert.ok(d.bizPending.ask!.questionIds.every((id) => id.startsWith('bp:')));
});

test('answering the open questions makes the widgets that depended on them ready', () => {
  const f = fixture('full');
  let overlay = f.overlay;
  const qs = buildQuestions(applyOverlay(f.txns, overlay), overlay);
  for (const q of qs.filter((x) => x.type === 'confirm_income')) overlay = applyAnswer(q, 'salary', false, overlay).overlay;
  for (const q of qs.filter((x) => x.type === 'one_off')) overlay = applyAnswer(q, 'one_off', false, overlay).overlay;
  const d = data('full', 'all', { overlay });
  assert.equal(d.kpis.readiness, 'ready');
  assert.equal(d.oneTime.readiness, 'ready');
  assert.equal(d.forecast.readiness, 'ready');
});

test('a covered month with no spending in a category is a real answer, not missing data', () => {
  const d = data('empty');
  assert.equal(d.fuel.readiness, 'ready');
  assert.equal(d.fuel.spent, 0);
  assert.equal(d.bigbox.readiness, 'ready');
  assert.equal(d.subscriptions.readiness, 'ready');
});

// ---- thresholds and gates from the brief ---------------------------------------------------------------------------------------------

test('grocery stays locked with 2 comparable items and unlocks at 3', () => {
  const store = (merchant: string, date: string, lines: [string, number][]): Txn => ({ id: `${merchant}${date}`, accountId: 'meadow-card-0202', date, description: merchant, merchant, cents: -lines.reduce((s, [, c]) => s + c, 0), kind: 'spend', category: 'groceries', source: 't', lines: lines.map(([item, cents]) => ({ item, cents })) });
  const base = fixture('empty').txns;
  const two = [...base, store('North Market', '2026-09-02', [['Rice', 900], ['Eggs', 300]]), store('South Market', '2026-09-03', [['Rice', 800], ['Eggs', 280]])];
  assert.equal(data('empty', 'all', { txns: two }).grocery.readiness, 'data');
  const three = [...two, store('North Market', '2026-09-09', [['Milk', 350]]), store('South Market', '2026-09-10', [['Milk', 320]])];
  const g = data('empty', 'all', { txns: three }).grocery;
  assert.equal(g.readiness, 'ready');
  assert.equal(g.comparable, 3);
  assert.ok(g.rows.every((r) => r.store === 'South Market'));
});

test('month pace needs 7 days of the month on statements: 6 is locked, 7 is shown', () => {
  const f = fixture('full');
  const withEnd = (to: string): DashboardInput => {
    const accounts = f.accounts.map((a) => (a.type === 'cash' ? a : { ...a, coverage: { ...a.coverage, to } }));
    const statements = f.statements.map((s) => (s.from === '2026-10-01' ? { ...s, to } : s));
    const i = inputFor('full');
    return { ...i, ctx: { ...i.ctx, accounts, statements }, dataTo: to };
  };
  assert.equal(dashboardData(withEnd('2026-10-06'), 'all').pace.readiness, 'data');
  const ok = dashboardData(withEnd('2026-10-07'), 'all').pace;
  assert.notEqual(ok.readiness, 'data');
  assert.equal(ok.days, 7);
  assert.equal(ok.daily.length, 7);
});

test('business profit and loss needs a business income source with deposits and a month of business spending', () => {
  const noSource = data('full', 'all', { overlay: { ...fixture('full').overlay, income: emptyIncome() } });
  assert.equal(noSource.bizPL.readiness, 'data');
  assert.equal(noSource.bizPL.lock!.action.kind, 'income');
  const ok = data('full');
  assert.notEqual(ok.bizPL.readiness, 'data');
  assert.ok(ok.bizPL.months.length >= 3);
  assert.ok(ok.bizPL.months.every((m) => m.net === m.income - m.spend));
});

// ---- data rules -----------------------------------------------------------------------------------------------------------------------

test('card payments and transfers are never spending; they are stated as not counted', () => {
  const d = data('full');
  const sep = fixture('full').txns.filter((t) => t.date.startsWith('2026-09'));
  const spendOnly = sep.filter((t) => ['spend', 'fee', 'refund'].includes(t.kind)).reduce((s, t) => s - t.cents, 0);
  assert.equal(d.kpis.spent, spendOnly);
  assert.ok(d.cashflow.transfers > 0, 'the card payments are reported as not counted');
});

test('rewards are kept apart from earnings', () => {
  const d = data('full', 'all', { period: '2026-08' });
  assert.ok(d.kpis.rewards > 0);
  const deposits = fixture('full').txns.filter((t) => t.kind === 'income' && t.date.startsWith('2026-08')).reduce((s, t) => s + t.cents, 0);
  assert.equal(d.kpis.earned, deposits);
});

test('Earned stays "not confirmed" while a deposit question is open', () => {
  const d = data('full');
  assert.equal(d.kpis.unconfirmed, 30000);
});

test('partial months are marked and left out of the average; one-offs are left out of the average too', () => {
  const d = data('full');
  const oct = d.trend.months.find((m) => m.month === '2026-10')!;
  assert.equal(oct.partial, true);
  assert.equal(d.trend.averageOf, 4);
  // June has a $2,380 travel charge waiting for its one-off answer: it is in June's bar, not in the average
  const june = d.trend.months.find((m) => m.month === '2026-06')!;
  assert.ok(june.total > d.trend.average! + 1500);
});

test('a missing statement between two saved ones makes that month incomplete', () => {
  const f = fixture('gapped');
  const ctx = { txns: f.txns, accounts: f.accounts, statements: f.statements };
  assert.deepEqual(completeMonths(ctx, '2026-06-01', '2026-10-12'), ['2026-06', '2026-07', '2026-09']);
  const d = data('gapped');
  assert.equal(d.trend.months.find((m) => m.month === '2026-08')!.partial, true);
  const card = d.dataHealth.accounts.find((a) => a.accountId === 'tidewater-visa-0303')!;
  assert.deepEqual(card.gaps.filter((g) => g.from.startsWith('2026-08')), [{ from: '2026-08-01', to: '2026-08-31' }]);
});

test('no spending accounts means no complete month, not every month', () => {
  assert.deepEqual(completeMonths({ accounts: [], statements: [] }, '2026-01-01', '2026-03-31'), []);
  assert.equal(coveredDays({ accounts: [], statements: [] }, '2026-03'), 0);
});

test('an account with no saved statements counts from its first to its last day; saved ones only add holes between them', () => {
  const a: Account = { id: 'a', name: 'A', institution: '', type: 'credit', last4: '1', coverage: { from: '2026-01-01', to: '2026-04-30' } };
  assert.deepEqual(intervalsFor(a, []), [{ from: '2026-01-01', to: '2026-04-30' }]);
  const iv = intervalsFor(a, [{ accountId: 'a', from: '2026-02-01', to: '2026-02-28' }, { accountId: 'a', from: '2026-04-01', to: '2026-04-30' }]);
  assert.deepEqual(gaps(iv, '2026-01-01', '2026-04-30'), [{ from: '2026-03-01', to: '2026-03-31' }]);
});

// ---- forecast --------------------------------------------------------------------------------------------------------------------------

test('every forecast has a range around it and a confidence, and leaves one-offs out', () => {
  for (const kind of ['full', 'gapped', 'empty'] as const) {
    const f = data(kind).forecast;
    assert.ok(f.forecast, kind);
    const { low, total, high, confidence } = f.forecast!;
    assert.ok(low <= total && total <= high, `${kind}: ${low} <= ${total} <= ${high}`);
    assert.ok(['low', 'medium', 'high'].includes(confidence));
  }
  const fc = data('full').forecast.forecast!;
  assert.ok(fc.oneOffsExcluded.some((o) => o.merchant === 'Skyway Travel Agency' && !o.confirmed));
  assert.ok(fc.oneOffsExcluded.some((o) => o.merchant === 'Bluewater Lodge' && o.confirmed));
});

test('the forecast and the Recurring screen use the same bills, including ones the person added', () => {
  const i = inputFor('full');
  const personal = i.ctx.txns.filter((t) => !t.business);
  const rec = summarizeRecurring(personal, i.ctx.recurring, i.dataTo).items.filter((x) => x.status === 'on' && x.health !== 'stopped');
  const fc = forecastMonth({ ...i.ctx, txns: personal }, '2026-11', i.dataTo);
  assert.equal(fc.recurringTotal, rec.reduce((s, x) => s + x.monthlyCents, 0));
  // a bill seen once, answered "repeats monthly", joins both
  const bill = data('full').billsOnce.bills[0];
  const recurring = addManual(i.ctx.recurring, { merchant: bill.merchant, cents: bill.cents, cadence: 'monthly', anchor: bill.date, category: bill.category });
  const after = forecastMonth({ ...i.ctx, txns: personal, recurring }, '2026-11', i.dataTo);
  assert.equal(after.recurringTotal, fc.recurringTotal + bill.cents);
  assert.ok(after.recurring.some((r) => r.merchant === bill.merchant));
  const d = dashboardData({ ...i, ctx: { ...i.ctx, recurring } }, 'all');
  assert.ok(!d.billsOnce.bills.some((b) => b.merchant === bill.merchant), 'and it is no longer asked about');
});

test('month pace leaves one-offs out of the spending so far', () => {
  const f = fixture('full');
  const big: Txn = { id: 'big', accountId: 'meadow-card-0202', date: '2026-10-05', description: 'X', merchant: 'Grand Piano Shop', cents: -500000, kind: 'spend', category: 'other', source: 't', oneOff: true };
  const before = data('full').pace.spent;
  assert.equal(data('full', 'all', { txns: [...f.txns, big] }).pace.spent, before);
});

// ---- save money ------------------------------------------------------------------------------------------------------------------------

test('repeating bills per year are the monthly amounts times 12, including bills added by hand', () => {
  const d = data('full');
  assert.equal(d.subscriptions.yearly, d.subscriptions.monthly * 12);
  for (const r of d.subscriptions.rows) assert.equal(r.yearly, r.monthly * 12);
  const i = inputFor('full');
  const recurring = addManual(i.ctx.recurring, { merchant: 'Hilltop Storage', cents: 4500, cadence: 'monthly', anchor: '2026-10-01' });
  const withManual = dashboardData({ ...i, ctx: { ...i.ctx, recurring } }, 'all').subscriptions;
  assert.equal(withManual.rows.find((r) => r.merchant === 'Hilltop Storage')!.yearly, 54000);
});

test('the price saving is against the next cheapest store, and the usual basket names the store cheapest for most items', () => {
  const t = (merchant: string, item: string, cents: number, n: number): Txn => ({ id: `${merchant}${item}${n}`, accountId: 'a', date: '2026-09-01', description: merchant, merchant, cents: -cents, kind: 'spend', source: 't', lines: [{ item, cents }] });
  const { compare } = compareItems([t('A', 'Milk', 300, 1), t('B', 'Milk', 340, 1), t('C', 'Milk', 500, 1), t('A', 'Bread', 200, 1), t('B', 'Bread', 260, 1)]);
  const milk = compare.find((c) => c.key === 'milk')!;
  assert.equal(milk.save, 40, 'next cheapest, not the dearest');
  const best = bestStore(usualBasket(compare))!;
  assert.equal(best.store, 'A');
  assert.equal(best.cheapestFor, 2);
  assert.ok(best.savingPerBasket > 0);
});

test('where you could spend less shows at most four ideas, each with a figure from real purchases', () => {
  const d = data('full');
  assert.ok(d.cutIdeas.ideas.length > 0 && d.cutIdeas.ideas.length <= 4);
  for (const i of d.cutIdeas.ideas) assert.match(i.figure, /\d/);
});

// ---- keep it accurate ------------------------------------------------------------------------------------------------------------------

test('paid from an account Finora cannot see counts card-side payments only', () => {
  const f = fixture('full');
  const { cardSide, bankSide, cardTotal } = unmatchedCardPayments(f.txns, f.accounts);
  assert.ok(cardSide.length > 0);
  assert.ok(cardSide.every((t) => t.accountId === 'tidewater-visa-0303'));
  assert.equal(bankSide.length, 0);
  assert.equal(data('full').dataHealth.unseenFunding, cardTotal);
});

test('the dollars at stake count each charge once, even when it is in several questions', () => {
  const tx: Txn[] = [{ id: 'x', accountId: 'a', date: '2026-09-01', description: 'X', merchant: 'X', cents: -150000, kind: 'spend', source: 't' }];
  const qs = [{ txnIds: ['x'], cents: 150000 }, { txnIds: ['x'], cents: 150000 }];
  assert.equal(uniqueCents(qs, tx), 150000);
  const i = inputFor('full');
  const d = dashboardData(i, 'all');
  assert.equal(d.attention.atStake, uniqueCents(i.questions, i.ctx.txns));
  assert.ok(d.attention.atStake <= i.questions.reduce((s, q) => s + q.cents, 0));
  assert.equal(d.attention.count, i.questions.length);
  assert.ok(d.attention.top.length <= 3);
  assert.deepEqual(d.attention.top.map((q) => q.cents), [...i.questions].map((q) => q.cents).sort((a, b) => b - a).slice(0, 3), 'the top three by amount');
});

test('answering several questions in one change keeps every answer', () => {
  const f = fixture('full');
  const qs = buildQuestions(applyOverlay(f.txns, f.overlay), f.overlay).filter((q) => q.type === 'business_or_personal');
  assert.ok(qs.length >= 2);
  const after = qs.reduce((o, q) => applyAnswer(q, 'business', true, o).overlay, f.overlay);
  const left = buildQuestions(applyOverlay(f.txns, after), after).filter((q) => q.type === 'business_or_personal');
  assert.equal(left.length, 0);
});

// ---- fixes from the phase 4 review ---------------------------------------------------------------------------------------------------

test('a charge marked one-time never makes a repeating bill', () => {
  const f = fixture('full');
  const marked = f.txns.map((t) => (t.merchant === 'Northpeak Mobile' ? { ...t, oneOff: true } : t));
  const fc = data('full', 'personal', { txns: marked }).forecast.forecast!;
  assert.ok(!fc.recurring.some((r) => r.merchant === 'Northpeak Mobile'));
});

test('a large monthly bill (rent) is a repeating bill, not a one-off waiting for an answer', () => {
  const f = fixture('full');
  const hinted = f.txns.map((t) => (t.merchant === 'Maple Court Apartments' ? { ...t, hints: ['large_one_off' as const] } : t));
  const d = data('full', 'personal', { txns: hinted });
  assert.ok(d.forecast.forecast!.recurring.some((r) => r.merchant === 'Maple Court Apartments'));
  assert.ok(!d.forecast.forecast!.oneOffsExcluded.some((o) => o.merchant === 'Maple Court Apartments'));
});

test('a cancelled bill leaves the everyday average the same way in the forecast and in Fixed bills vs everyday', () => {
  const i = inputFor('full');
  const rec = summarizeRecurring(i.ctx.txns.filter((t) => !t.business), i.ctx.recurring, i.dataTo).items.find((x) => x.merchant === 'Northpeak Mobile')!;
  const recurring = { ...i.ctx.recurring!, edits: { ...i.ctx.recurring!.edits, [rec.key]: { status: 'cancelled' as const } } };
  const d = dashboardData({ ...i, ctx: { ...i.ctx, recurring } }, 'personal');
  assert.equal(d.fixedFlex.everyday, d.forecast.forecast!.variableTotal);
  assert.equal(data('full', 'personal').fixedFlex.everyday, d.fixedFlex.everyday, 'cancelling a bill does not move its old charges into everyday spending');
});

test('"if the bills seen once repeat" is the forecast with them added as monthly bills, not counted twice', () => {
  const i = inputFor('full');
  const d = dashboardData(i, 'personal');
  const recurring = d.billsOnce.bills.reduce((r, b) => addManual(r, { merchant: b.merchant, cents: b.cents, cadence: 'monthly', anchor: b.date, category: b.category }), i.ctx.recurring);
  const expected = forecastMonth({ ...i.ctx, txns: i.ctx.txns.filter((t) => !t.business), recurring }, d.forecast.target, i.dataTo, 'given').total;
  assert.equal(d.forecastBuild.ifBillsRepeat, expected);
});

test('Household and Plan ahead leave business income out of Earned; Overview counts it; Business counts only it', () => {
  const all = data('full', 'all').kpis.earned, personal = data('full', 'personal').kpis.earned, business = data('full', 'business').kpis.earned;
  assert.ok(business > 0);
  assert.equal(all, personal + business);
});

test('a widget follows the view it is shown in: a forecast in Business is a business forecast', () => {
  const biz = data('full', 'business').forecast.forecast!;
  const personal = data('full', 'personal').forecast.forecast!;
  assert.ok(biz.total < personal.total);
  assert.ok(data('full', 'business').subscriptions.rows.every((r) => !/Maple Court|Northpeak/.test(r.merchant)), 'no household bills in Business');
});

test('a statement covering only the middle of a month still gives that month numbers', () => {
  const i = inputFor('full');
  const accounts = i.ctx.accounts.map((a) => (a.type === 'cash' ? a : { ...a, coverage: { from: '2026-10-10', to: '2026-10-18' } }));
  const d = dashboardData({ ...i, period: '2026-10', ctx: { ...i.ctx, accounts, statements: [] }, dataFrom: '2026-10-10', dataTo: '2026-10-18' }, 'all');
  assert.notEqual(d.kpis.readiness, 'data');
});

test('a reversed card payment is not counted as money from an account Finora cannot see', () => {
  const accounts: Account[] = [{ id: 'c', name: 'C', institution: '', type: 'credit', last4: '9', coverage: { from: '2026-01-01', to: '2026-01-31' } }];
  const tx = (cents: number, id: string): Txn => ({ id, accountId: 'c', date: '2026-01-05', description: 'P', merchant: 'Payment', cents, kind: 'transfer', subtype: 'card_payment', source: 't' });
  const r = unmatchedCardPayments([tx(50000, 'in'), tx(-50000, 'reversal')], accounts);
  assert.equal(r.cardTotal, 50000);
  assert.equal(r.cardSide.length, 1);
});

test('the basket recommendation counts items that cost more at a store against it', () => {
  const t = (merchant: string, item: string, cents: number): Txn => ({ id: `${merchant}${item}`, accountId: 'a', date: '2026-09-01', description: merchant, merchant, cents: -cents, kind: 'spend', source: 't', lines: [{ item, cents }] });
  // A is $1 cheaper for milk and bread, but $100 dearer for a big item; B is the better basket
  const { compare } = compareItems([t('A', 'Milk', 300), t('B', 'Milk', 400), t('A', 'Bread', 200), t('B', 'Bread', 300), t('A', 'Grill', 30000), t('B', 'Grill', 20000)]);
  const best = bestStore(usualBasket(compare))!;
  assert.equal(best.store, 'B');
  assert.equal(best.savingPerBasket, (350 - 400) + (250 - 300) + (25000 - 20000));
});

// ---- fixes from the phase 5 review ---------------------------------------------------------------------------------------------------

test('a bill added by hand is a household bill: it stays out of the Business view', () => {
  const i = inputFor('full');
  const recurring = addManual(i.ctx.recurring, { merchant: 'Hilltop Storage', cents: 100000, cadence: 'monthly', anchor: '2026-10-01' });
  const withBill = { ...i, ctx: { ...i.ctx, recurring } };
  const biz = dashboardData(withBill, 'business');
  assert.ok(!biz.subscriptions.rows.some((r) => r.merchant === 'Hilltop Storage'));
  assert.equal(biz.forecast.forecast!.recurringTotal, dashboardData(i, 'business').forecast.forecast!.recurringTotal);
  assert.ok(dashboardData(withBill, 'personal').subscriptions.rows.some((r) => r.merchant === 'Hilltop Storage'));
});

test('a refund larger than its group never pushes a slice past 100%', () => {
  const tx = (id: string, category: string, cents: number, kind: Txn['kind'] = 'spend'): Txn => ({ id, accountId: 'meadow-card-0202', date: '2026-09-03', description: id, merchant: id, cents, kind, category, source: 't' });
  const d = data('empty', 'all', { txns: [tx('g', 'groceries', -10000), tx('r', 'travel', 5000, 'refund')] });
  assert.equal(d.donut.total, 5000);
  assert.equal(d.donut.netCredit, 5000);
  assert.ok(d.donut.slices.every((s) => s.share <= 1));
  assert.equal(d.donut.slices.reduce((s, x) => s + x.share, 0), 1);
});

test('fixed bills vs everyday asks for the bills it found to be confirmed', () => {
  const i = inputFor('full');
  const noOneOffs = { ...i, questions: i.questions.filter((q) => q.type !== 'one_off') };
  const d = dashboardData(noOneOffs, 'personal');
  assert.equal(d.fixedFlex.readiness, 'answers');
  assert.match(d.fixedFlex.ask!.text, /not confirmed/);
});

// ---- views -------------------------------------------------------------------------------------------------------------------------------

test('each view counts its own spending: Household leaves business out, Business counts only business', () => {
  const all = data('full', 'all').kpis.spent, personal = data('full', 'personal').kpis.spent, business = data('full', 'business').kpis.spent;
  assert.equal(all, personal + business);
  assert.ok(business > 0);
});
