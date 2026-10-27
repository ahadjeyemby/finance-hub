// Everything the 22 dashboard widgets show, computed from the effective ledger (the rows with every answer, rule and edit already applied).
// Pure TypeScript: no React, no storage. Each widget gets its numbers and its readiness:
//   ready    the full chart
//   answers  the chart, provisional, with the Inbox questions (or the widget's own buttons) that would change it
//   data     not enough data: what is missing and the one action that unlocks it
// The data rules apply everywhere: card payments and transfers are never spending; partial months are labelled "so far" and left out of
// averages and forecasts; one-offs are left out of averages and forecasts and shown on their own; Earned stays "not confirmed" until the
// deposits are answered; a forecast always has a range; nothing is invented.
import { unmatchedCardPayments } from './accounts';
import { categoryLabel, colorGroupOf } from './categories';
import type { ColorGroup } from './categories';
import { completeMonths, coveredDays, coversAny, gaps, intervalsFor, spendAccounts } from './coverage';
import type { Interval } from './coverage';
import { addMonths, daysInMonth, monthEnd, monthOf, monthStart } from './dates';
import { forecastMonth, recurringBasis } from './forecast';
import type { Forecast } from './forecast';
import { attribute } from './income';
import type { IncomeState } from './income';
import { bestStore, compareItems, usualBasket } from './prices';
import type { ItemCompare } from './prices';
import type { Ctx } from './queries';
import { uniqueCents } from './questions';
import { addManual, normKey } from './recurring';
import type { RecurringItem } from './recurring';
import type { Question, Txn } from './types';

export type Readiness = 'ready' | 'answers' | 'data';
export type Scope = 'all' | 'personal' | 'business';
/** where the one unlocking action goes; the screen turns it into a route */
export type ActionKind = 'import' | 'receipts' | 'income' | 'inbox' | 'categories' | 'accounts';
export interface Lock { missing: string; action: { label: string; kind: ActionKind } }
export interface Ask { text: string; questionIds: string[] }
export interface State { readiness: Readiness; lock?: Lock; ask?: Ask }

export interface DashboardInput {
  ctx: Ctx;
  questions: Question[];
  /** 'YYYY-MM' or 'all' */
  period: string;
  dataFrom: string;
  dataTo: string;
  income: IncomeState;
  /** receipts saved with a date after the newest statement: they count once that statement is imported */
  receiptsWaiting: number;
}

const SPEND = new Set(['spend', 'fee', 'refund']);
const isSpend = (t: Txn) => SPEND.has(t.kind);
const out = (t: Txn) => -t.cents;
const inScope = (scope: Scope) => (t: Txn) => (scope === 'all' ? true : scope === 'business' ? t.business === true : !t.business);
const sum = (ts: Txn[]) => ts.reduce((s, t) => s + out(t), 0);
const inRange = (t: Txn, from: string, to: string) => t.date >= from && t.date <= to;

const IMPORT: Lock['action'] = { label: 'Import a statement', kind: 'import' };
const RECEIPTS: Lock['action'] = { label: 'Add receipts', kind: 'receipts' };

const ready = (): State => ({ readiness: 'ready' });
const locked = (missing: string, action = IMPORT): State => ({ readiness: 'data', lock: { missing, action } });
/** answers when any of these questions is open, otherwise ready */
const askIf = (qs: Question[], text: (n: number) => string): State => (qs.length ? { readiness: 'answers', ask: { text: text(qs.length), questionIds: qs.map((q) => q.id) } } : ready());
const touching = (qs: Question[], ids: Set<string>) => qs.filter((q) => q.txnIds.some((id) => ids.has(id)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Bills that show up once on a statement: worth asking whether they repeat. */
const BILL_CATEGORIES = new Set(['insurance', 'phone', 'subscriptions', 'education', 'housing', 'utilities']);
/** Software and services that often belong to a business. */
const TOOL_CATEGORIES = new Set(['subscriptions', 'electronics']);

// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface KpisData extends State {
  month: string | null; label: string; complete: boolean;
  spent: number; earned: number; left: number; rewards: number;
  /** deposits nobody has confirmed yet, part of Earned */
  unconfirmed: number;
  /** Spent against the month before, only when both months are complete; otherwise why not */
  change: { pct: number; prevMonth: string } | { none: string };
  incomeIncomplete: boolean;
}
export interface CashflowData extends State { earned: number; spent: number; left: number; transfers: number; unconfirmed: number; label: string }
export interface GroupSlice { group: ColorGroup; cents: number; share: number }
export interface DonutData extends State { slices: GroupSlice[]; total: number; from: string; to: string; /** refunds larger than the purchases in their group, left out of the slices (0 almost always) */ netCredit: number }
export interface TrendMonth { month: string; partial: boolean; total: number; byGroup: Record<ColorGroup, number> }
export interface TrendData extends State { months: TrendMonth[]; average: number | null; averageOf: number; selected: string | null }
export interface OneTimeData extends State { total: number; oneOffs: number; share: number; withoutOneOffs: number; largest: { merchant: string; cents: number; date: string } | null; pending: number }
export interface CutIdea { kind: 'basket' | 'bills' | 'unsplit' | 'rise'; title: string; text: string; figure: string; unit: string; action: { label: string; kind: ActionKind | 'prices' | 'recurring' | 'explore' } }
export interface CutIdeasData extends State { ideas: CutIdea[] }
export interface FixedFlexData extends State { fixed: number; everyday: number; share: number; noHousing: boolean; months: number }
export interface SubscriptionRow { key: string; merchant: string; monthly: number; yearly: number; confirmed: boolean }
export interface SubscriptionsData extends State { rows: SubscriptionRow[]; monthly: number; yearly: number }
export interface GroceryRow { item: string; store: string; price: number; save: number; next: string }
export interface GroceryData extends State { rows: GroceryRow[]; perBasket: number; comparable: number }
export interface BigBoxRow { merchant: string; cents: number; share: number }
export interface BigBoxData extends State { rows: BigBoxRow[]; total: number; unsplit: number }
export interface FuelMonth { month: string; cents: number; partial: boolean }
export interface FuelData extends State { spent: number; fillUps: number; average: number; months: FuelMonth[]; top: { merchant: string; share: number } | null }
export interface ForecastData extends State { forecast: Forecast | null; target: string; max: number }
export interface ForecastBuildData extends State { forecast: Forecast | null; target: string; oneOffs: number; ifBillsRepeat: number | null; billsOnceCents: number }
export interface PaceData extends State { month: string; days: number; daysInMonth: number; daily: number[]; forecast: number | null; spent: number; /** where a straight line to the forecast would be today */ expectedByNow: number | null }
export interface BillOnce { txnId: string; merchant: string; date: string; cents: number; category?: string }
export interface BillsOnceData extends State { bills: BillOnce[] }
export interface BizSummaryData extends State { tagged: number; waiting: number; toolsMonthly: number; income: number | null; hasSource: boolean }
export interface BizPendingRow { question: Question; merchant: string; cents: number; charges: number }
export interface BizPendingData extends State { rows: BizPendingRow[]; total: number }
export interface BizDonutData extends State { slices: { merchant: string; cents: number; share: number }[]; total: number }
export interface ToolRow { key: string; merchant: string; monthly: number; yearly: number; confirmed: boolean; questions: Question[] }
export interface BizToolsData extends State { rows: ToolRow[]; undecided: Question[]; /** undecided tools per month */ monthly: number; /** every tool listed, per year */ yearly: number }
export interface PLMonth { month: string; income: number; spend: number; net: number }
export interface BizPLData extends State { months: PLMonth[]; income: number; spend: number; net: number }
export interface AttentionData extends State { count: number; atStake: number; top: { id: string; text: string; cents: number }[]; /** the top three together, each charge once */ topCents: number }
export interface CoverageRow { accountId: string; name: string; from: string; to: string; coverage: Interval[]; gaps: Interval[]; share: number }
export interface DataHealthData extends State { from: string; to: string; accounts: CoverageRow[]; unseenFunding: number; unseenCount: number; missingCardStatements: number; receiptsWaiting: number }

export interface DashboardData {
  kpis: KpisData; cashflow: CashflowData; donut: DonutData; trend: TrendData; oneTime: OneTimeData;
  cutIdeas: CutIdeasData; fixedFlex: FixedFlexData; subscriptions: SubscriptionsData; grocery: GroceryData; bigbox: BigBoxData; fuel: FuelData;
  forecast: ForecastData; forecastBuild: ForecastBuildData; pace: PaceData; billsOnce: BillsOnceData;
  bizSummary: BizSummaryData; bizPending: BizPendingData; bizDonut: BizDonutData; bizTools: BizToolsData; bizPL: BizPLData;
  attention: AttentionData; dataHealth: DataHealthData;
}

const emptyGroups = (): Record<ColorGroup, number> => ({ travel: 0, bigbox: 0, groceries: 0, fuel: 0, medical: 0, other: 0 });

/** Months between the first and last statement day, oldest first. */
function statementMonths(from: string, to: string): string[] {
  const res: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) res.push(m);
  return res;
}

/**
 * Every widget for one view. `scope` is whose spending the view counts (Overview everything, Household and Plan ahead personal, Business
 * business), and every widget shown in that view follows it; the Business widgets are about business by definition.
 */
export function dashboardData(input: DashboardInput, scope: Scope): DashboardData {
  const { ctx, questions, period, dataFrom, dataTo, income } = input;
  const hasAccounts = spendAccounts(ctx.accounts).length > 0;
  const scoped = ctx.txns.filter(inScope(scope));
  // bills added by hand carry no business flag: they are household bills, so a Business view leaves them out
  const recurring = scope === 'business' && ctx.recurring ? { ...ctx.recurring, manual: [] } : ctx.recurring;
  const sctx: Ctx = { ...ctx, txns: scoped, recurring };
  const byId = new Map(ctx.txns.map((t) => [t.id, t]));
  const uniq = (qs: Question[]) => uniqueCents(qs, byId);
  const months = hasAccounts ? statementMonths(dataFrom, dataTo) : [];
  const complete = new Set(hasAccounts ? completeMonths(ctx, dataFrom, dataTo) : []);
  const anyData = hasAccounts && months.length > 0;
  const qOf = (type: Question['type']) => questions.filter((q) => q.type === type);
  const NO_STATEMENT = 'No statement covers any month yet.';
  // the bills and one-offs every average and forecast in this view is built from (the same rules as the forecast and the Recurring screen)
  const basis = recurringBasis(scoped, recurring, dataTo);
  const isOneOff = basis.isOneOff;
  /** questions about large charges that would change a complete-month average: open one-off candidates in complete months */
  const oneOffQsIn = (monthsSet: Set<string>) => touching(qOf('one_off'), new Set(scoped.filter((t) => isSpend(t) && monthsSet.has(monthOf(t.date)) && isOneOff(t) && t.oneOff !== true).map((t) => t.id)));

  // ---- Big picture ----------------------------------------------------------------------------------------------------------------------
  const selMonth = period === 'all' ? null : period;
  const from = selMonth ? monthStart(selMonth) : dataFrom;
  const to = selMonth ? monthEnd(selMonth) : dataTo;
  const inSel = (t: Txn) => inRange(t, from, to);
  const selSpend = scoped.filter((t) => isSpend(t) && inSel(t));
  const incomeTxns = ctx.txns.filter((t) => t.kind === 'income' && inSel(t));
  const businessSources = new Set(income.sources.filter((s) => s.type === 'business').map((s) => s.id));
  const sourceOf = attribute(ctx.txns, income, ctx.accounts);
  const isBizIncome = (t: Txn) => businessSources.has(sourceOf.get(t.id) ?? '');
  // Business counts business income only; Household leaves it out; Overview counts every deposit
  const earnedTxns = scope === 'business' ? incomeTxns.filter(isBizIncome) : scope === 'personal' ? incomeTxns.filter((t) => !isBizIncome(t)) : incomeTxns;
  const earned = earnedTxns.reduce((s, t) => s + t.cents, 0);
  const spent = sum(selSpend);
  const rewards = ctx.txns.filter((t) => t.kind === 'rewards' && inSel(t)).reduce((s, t) => s + t.cents, 0);
  const unconfirmedTxns = earnedTxns.filter((t) => t.subtype === 'unconfirmed');
  const unconfirmed = unconfirmedTxns.reduce((s, t) => s + t.cents, 0);
  // a month has numbers as soon as any statement covers any day of it
  const selCovered = hasAccounts && (selMonth ? coversAny(ctx, monthStart(selMonth), monthEnd(selMonth)) : anyData);
  const selComplete = selMonth ? complete.has(selMonth) : false;
  const incomeQs = touching(qOf('confirm_income'), new Set(unconfirmedTxns.map((t) => t.id)));
  const moneyState = !selCovered ? locked(selMonth ? 'No statement covers this month yet.' : NO_STATEMENT)
    : askIf(incomeQs, (n) => `${plural(n, 'deposit question')} ${n === 1 ? 'decides' : 'decide'} what counts as Earned.`);
  const prev = selMonth ? addMonths(selMonth, -1) : null;
  const change: KpisData['change'] = !selMonth ? { none: 'Pick a month to compare it with the one before.' }
    : !selComplete ? { none: 'This month is not complete yet, so it is not compared.' }
    : !prev || !complete.has(prev) ? { none: 'The month before is not complete, so there is nothing to compare with.' }
    : (() => { const p = sum(scoped.filter((t) => isSpend(t) && monthOf(t.date) === prev)); return p > 0 ? { pct: (spent - p) / p, prevMonth: prev } : { none: 'Nothing was spent the month before.' }; })();
  const kpis: KpisData = {
    ...moneyState, month: selMonth, label: selMonth ?? 'all', complete: selComplete, spent, earned, left: earned - spent, rewards, unconfirmed, change,
    incomeIncomplete: ctx.accounts.some((a) => a.type === 'checking' && a.incomeComplete === false),
  };
  // transfers: each movement once (the bank side, or a card side with no bank leg), never spending
  const typeOf = new Map(ctx.accounts.map((a) => [a.id, a.type]));
  const transfers = ctx.txns.filter((t) => t.kind === 'transfer' && inSel(t)).reduce((s, t) => {
    const type = typeOf.get(t.accountId);
    if (type === 'checking' || type === 'cash') return t.cents < 0 ? s - t.cents : s;
    return t.pairId ? s : s + Math.abs(t.cents);
  }, 0);
  const cashflow: CashflowData = { ...moneyState, earned, spent, left: earned - spent, transfers, unconfirmed, label: kpis.label };

  const allSpend = scoped.filter((t) => isSpend(t) && inRange(t, dataFrom, dataTo));
  const catQs = [...qOf('category'), ...qOf('person_payment')];
  const catState = (): State => (!anyData ? locked(NO_STATEMENT) : askIf(touching(catQs, new Set(allSpend.map((t) => t.id))), (n) => `${plural(n, 'charge question')} decide which category some spending is in.`));
  const groups = emptyGroups();
  for (const t of allSpend) groups[colorGroupOf(t.category)] += out(t);
  const donutTotal = Object.values(groups).reduce((a, b) => a + b, 0);
  // a group whose refunds outweigh its purchases has no slice; the shares are of the slices drawn, and the credit is stated beside them
  const positive = (Object.keys(groups) as ColorGroup[]).filter((g) => groups[g] > 0);
  const drawn = positive.reduce((s, g) => s + groups[g], 0);
  const donut: DonutData = {
    ...catState(), from: dataFrom, to: dataTo, total: donutTotal, netCredit: drawn - donutTotal,
    slices: positive.map((g) => ({ group: g, cents: groups[g], share: drawn > 0 ? groups[g] / drawn : 0 })).sort((a, b) => b.cents - a.cents),
  };

  const spendByMonth = new Map<string, Txn[]>();
  for (const t of allSpend) { const m = monthOf(t.date); spendByMonth.set(m, [...(spendByMonth.get(m) ?? []), t]); }
  const inMonth = (m: string) => spendByMonth.get(m) ?? [];
  const trendMonths: TrendMonth[] = months.map((m) => {
    const byGroup = emptyGroups();
    for (const t of inMonth(m)) byGroup[colorGroupOf(t.category)] += out(t);
    return { month: m, partial: !complete.has(m), total: Object.values(byGroup).reduce((a, b) => a + b, 0), byGroup };
  });
  const fullMonths = trendMonths.filter((m) => !m.partial);
  // the average leaves out partial months and one-offs
  const avgOf = (m: string) => sum(inMonth(m).filter((t) => !isOneOff(t)));
  const trend: TrendData = {
    ...catState(), months: trendMonths, selected: selMonth, averageOf: fullMonths.length,
    average: fullMonths.length ? Math.round(fullMonths.reduce((s, m) => s + avgOf(m.month), 0) / fullMonths.length) : null,
  };

  const oneOffTxns = allSpend.filter((t) => t.oneOff === true);
  const candidates = allSpend.filter((t) => isOneOff(t) && t.oneOff !== true);
  const oneOffSum = sum(oneOffTxns);
  const largestOne = [...oneOffTxns].sort((a, b) => a.cents - b.cents)[0];
  const oneTime: OneTimeData = {
    ...(!anyData ? locked(NO_STATEMENT) : askIf(touching(qOf('one_off'), new Set(allSpend.map((t) => t.id))), (n) => `${plural(n, 'large charge')} may be one-time: your answer decides.`)),
    total: donutTotal, oneOffs: oneOffSum, share: donutTotal > 0 ? oneOffSum / donutTotal : 0, withoutOneOffs: donutTotal - oneOffSum,
    largest: largestOne ? { merchant: largestOne.merchant, cents: out(largestOne), date: largestOne.date } : null, pending: sum(candidates),
  };

  // ---- Save money ------------------------------------------------------------------------------------------------------------------------
  const pSpendAll = allSpend;
  const bills = basis.on;
  const yearly = (i: RecurringItem) => i.monthlyCents * 12;
  const { compare } = compareItems(pSpendAll);
  const basket = usualBasket(compare);
  const best = bestStore(basket);
  const unsplitTxns = pSpendAll.filter((t) => t.category === 'mixed_retail' && t.hints?.includes('needs_items') && !t.lines?.length);
  const unsplit = sum(unsplitTxns);
  const ideas: CutIdea[] = [];
  if (best) ideas.push({ kind: 'basket', title: `Buy your usual basket at ${best.store}`, text: `It prices ${best.covers} of the ${best.of} items you buy most, and is cheapest for ${best.cheapestFor}. Together they cost less there than you paid on average.`, figure: money(best.savingPerBasket), unit: 'less per basket', action: { label: 'Compare prices', kind: 'prices' } });
  if (bills.length) {
    const top = [...bills].sort((a, b) => b.monthlyCents - a.monthlyCents)[0];
    const total = bills.reduce((s, i) => s + yearly(i), 0);
    ideas.push({ kind: 'bills', title: `Review ${plural(bills.length, 'repeating bill')}`, text: bills.length > 1 ? `${top.merchant} is the largest at ${money(top.monthlyCents)} a month.` : `${top.merchant} at ${money(top.monthlyCents)} a month.`, figure: money(total, true), unit: 'a year', action: { label: 'Review bills', kind: 'recurring' } });
  }
  if (unsplit > 0) {
    const stores = [...new Set(unsplitTxns.map((t) => t.merchant))];
    ideas.push({ kind: 'unsplit', title: 'Split big-box receipts', text: `${listNames(stores)} ${stores.length > 1 ? 'have' : 'has'} no item detail, so savings there can't be found yet.`, figure: money(unsplit, true), unit: 'unsplit', action: { label: 'Add receipts', kind: 'receipts' } });
  }
  const fullList = [...complete].sort();
  const lastTwo = fullList.length >= 2 && fullList[fullList.length - 1] === addMonths(fullList[fullList.length - 2], 1) ? fullList.slice(-2) : null;
  if (lastTwo) {
    const [a, b] = lastTwo;
    const byCat = (m: string) => { const r = new Map<string, number>(); for (const t of inMonth(m)) if (!isOneOff(t)) r.set(t.category ?? 'uncategorized', (r.get(t.category ?? 'uncategorized') ?? 0) + out(t)); return r; };
    const pa = byCat(a), pb = byCat(b);
    let rise: { cat: string; from: number; to: number } | null = null;
    for (const [cat, v] of pb) { const p = pa.get(cat) ?? 0; if (p > 0 && v > p && (!rise || v - p > rise.to - rise.from)) rise = { cat, from: p, to: v }; }
    if (rise) {
      const inB = inMonth(b).filter((t) => (t.category ?? 'uncategorized') === rise.cat && !isOneOff(t));
      const topM = topMerchant(inB);
      const label = categoryLabel(rise.cat);
      ideas.push({ kind: 'rise', title: `${label} rose in ${monthName(b)}`, text: `${money(rise.to)} against ${money(rise.from)} in ${monthName(a)}.${topM ? ` ${topM.merchant} took ${Math.round(topM.share * 100)}%.` : ''}`, figure: `+${Math.round(((rise.to - rise.from) / rise.from) * 100)}%`, unit: `vs ${monthName(a)}`, action: { label: 'Open in Explore', kind: 'explore' } });
    }
  }
  // a basket with no receipt is a question in the Inbox: while the unsplit idea is shown, its receipts are what would change it
  const itemsQs = qOf('items');
  const unsplitQs = touching(itemsQs, new Set(unsplitTxns.map((t) => t.id)));
  const cutIdeas: CutIdeasData = {
    ...(!ideas.length ? locked('No saving can be worked out yet: it needs the same item at two stores, a repeating bill, or two complete months.', anyData ? RECEIPTS : IMPORT)
      : unsplit > 0 && unsplitQs.length ? { readiness: 'answers', ask: { text: 'Receipts for the big-box stores would show what that spending was, and where it could be less.', questionIds: unsplitQs.map((q) => q.id) } } : ready()),
    ideas: ideas.slice(0, 4),
  };

  const fixed = bills.reduce((s, i) => s + i.monthlyCents, 0);
  const everydayMonths = fullList;
  const everyday = everydayMonths.length ? Math.round(everydayMonths.reduce((s, m) => s + sum(inMonth(m).filter(basis.isEveryday)), 0) / everydayMonths.length) : 0;
  const noHousing = !bills.some((i) => i.category === 'housing' || i.category === 'utilities');
  // bills found by the app but not confirmed are answered on the Recurring screen, not in the Inbox; they decide the fixed part
  const detected = bills.filter((i) => i.source === 'detected');
  const confirmBills = (lead: string): State => (detected.length ? { readiness: 'answers', ask: { text: `${plural(detected.length, 'bill')} found in your statements ${detected.length === 1 ? 'is' : 'are'} not confirmed${lead}`, questionIds: [] } } : ready());
  const ffOneOff = askIf(oneOffQsIn(complete), (n) => `${plural(n, 'large charge')} may be one-time, which changes the everyday average.`);
  const fixedFlex: FixedFlexData = {
    ...(!everydayMonths.length ? locked('No complete month yet: a month counts once every account\'s statement covers all of it.')
      : ffOneOff.readiness === 'answers' ? ffOneOff : confirmBills(', so the fixed part may change.')),
    fixed, everyday, share: fixed + everyday > 0 ? fixed / (fixed + everyday) : 0, noHousing, months: everydayMonths.length,
  };

  const subRows: SubscriptionRow[] = [...bills].sort((a, b) => b.monthlyCents - a.monthlyCents).map((i) => ({ key: i.key, merchant: i.merchant, monthly: i.monthlyCents, yearly: yearly(i), confirmed: i.source !== 'detected' }));
  const subscriptions: SubscriptionsData = {
    ...(!anyData && !bills.length ? locked(NO_STATEMENT) : confirmBills(' yet.')),
    rows: subRows, monthly: fixed, yearly: fixed * 12,
  };

  const groceryRows: GroceryRow[] = basket.map((it: ItemCompare) => ({ item: it.item, store: it.rows[0].store, price: it.rows[0].avg, save: it.save, next: it.rows[1].store }));
  const grocery: GroceryData = {
    ...(compare.length >= 3 ? ready() : locked(`Prices from two or more stores are needed for 3 items; ${compare.length === 0 ? 'none has them yet' : `${plural(compare.length, 'item has', 'items have')} them so far`}.`, RECEIPTS)),
    rows: groceryRows, perBasket: groceryRows.reduce((s, r) => s + r.save, 0), comparable: compare.length,
  };

  const bigTxns = pSpendAll.filter((t) => t.category === 'mixed_retail');
  const bigTotal = sum(bigTxns);
  const bigBy = new Map<string, number>();
  for (const t of bigTxns) bigBy.set(t.merchant, (bigBy.get(t.merchant) ?? 0) + out(t));
  const bigMerchants = new Set(bigTxns.map((t) => t.id));
  const bigbox: BigBoxData = {
    ...(!anyData ? locked(NO_STATEMENT) : askIf(touching(itemsQs, bigMerchants), (n) => `Receipts for ${plural(n, 'store')} would split this spending by item.`)),
    rows: [...bigBy.entries()].map(([merchant, cents]) => ({ merchant, cents, share: bigTotal > 0 ? cents / bigTotal : 0 })).sort((a, b) => b.cents - a.cents),
    total: bigTotal, unsplit,
  };

  const fuelTxns = pSpendAll.filter((t) => t.category === 'fuel');
  const fills = fuelTxns.filter((t) => t.kind === 'spend' && t.cents < 0);
  const fuelSpent = sum(fuelTxns);
  const fuelTop = topMerchant(fills);
  const fuel: FuelData = {
    ...(!anyData ? locked(NO_STATEMENT) : ready()),
    spent: fuelSpent, fillUps: fills.length, average: fills.length ? Math.round(sum(fills) / fills.length) : 0,
    months: months.map((m) => ({ month: m, cents: sum(fuelTxns.filter((t) => monthOf(t.date) === m)), partial: !complete.has(m) })), top: fuelTop,
  };

  // ---- Plan ahead ------------------------------------------------------------------------------------------------------------------------
  const target = addMonths(monthOf(dataTo), 1);
  const fc = anyData ? forecastMonth(sctx, target, dataTo, 'given') : null;
  const hasBasis = !!fc && fc.basisMonths.length > 0;
  const fcState: State = !hasBasis ? locked('No complete month yet, so there is nothing to base a forecast on.')
    : askIf(oneOffQsIn(new Set(fc!.basisMonths)), (n) => `${plural(n, 'large charge')} may be one-time, which changes the forecast.`);
  const forecast: ForecastData = { ...fcState, forecast: hasBasis ? fc : null, target, max: hasBasis ? niceCeil(Math.max(fc!.high, fc!.total)) : 0 };

  // bills seen once: a bill-like charge from a payee seen only once, that nobody has decided about
  const payeeCount = new Map<string, number>();
  for (const t of scoped) if (isSpend(t) && t.cents < 0) payeeCount.set(normKey(t.merchant), (payeeCount.get(normKey(t.merchant)) ?? 0) + 1);
  const knownPayees = new Set([...(ctx.recurring?.manual ?? []).map((m) => normKey(m.merchant)), ...bills.map((i) => normKey(i.merchant))]);
  const once: BillOnce[] = scoped.filter((t) => t.kind === 'spend' && t.cents < 0 && BILL_CATEGORIES.has(t.category ?? '') && t.oneOff === undefined
    && payeeCount.get(normKey(t.merchant)) === 1 && !knownPayees.has(normKey(t.merchant)) && inRange(t, addMonths(monthOf(dataTo), -12) + '-01', dataTo))
    .map((t) => ({ txnId: t.id, merchant: t.merchant, date: t.date, cents: out(t), category: t.category })).sort((a, b) => b.date.localeCompare(a.date));
  const billsOnceCents = once.reduce((s, b) => s + b.cents, 0);
  const billsOnce: BillsOnceData = {
    ...(!fullList.length ? locked('With no complete month yet, a bill seen once cannot be told apart from a new monthly one.')
      : once.length ? { readiness: 'answers', ask: { text: `${plural(once.length, 'bill')} appeared once. Say whether each repeats.`, questionIds: [] } } : ready()),
    bills: once,
  };

  const forecastBuild: ForecastBuildData = {
    ...(fcState.readiness !== 'ready' ? fcState : once.length ? { readiness: 'answers', ask: { text: `${plural(once.length, 'bill')} seen once may repeat.`, questionIds: [] } } : ready()),
    forecast: hasBasis ? fc : null, target, oneOffs: fc ? fc.oneOffsExcluded.reduce((s, o) => s + o.cents, 0) : 0,
    // what next month would be if every bill seen once were a monthly bill: the same forecast, with each added as one (so a bill already in the
    // everyday average is not counted twice)
    ifBillsRepeat: hasBasis && once.length
      ? forecastMonth({ ...sctx, recurring: once.reduce((r, b) => addManual(r, { merchant: b.merchant, cents: b.cents, cadence: 'monthly', anchor: b.date, category: b.category }), recurring) }, target, dataTo, 'given').total
      : null,
    billsOnceCents,
  };

  // the month in progress: the latest month with statements, unless it is already complete (then the next one, with no days yet)
  const paceMonth = !anyData ? monthOf(dataTo) : complete.has(monthOf(dataTo)) ? addMonths(monthOf(dataTo), 1) : monthOf(dataTo);
  const paceDays = anyData ? coveredDays(ctx, paceMonth) : 0;
  const paceFc = anyData ? forecastMonth(sctx, paceMonth, dataTo, 'given') : null;
  const paceBase = paceFc && paceFc.basisMonths.length ? paceFc.recurringTotal + paceFc.variableTotal : null;
  const perDay = new Array<number>(paceDays + 1).fill(0);
  for (const t of inMonth(paceMonth)) { const d = Number(t.date.slice(8)); if (d <= paceDays && !isOneOff(t)) perDay[d] += out(t); }
  const daily: number[] = [];
  let run = 0;
  for (let d = 1; d <= paceDays; d++) { run += perDay[d]; daily.push(run); }
  const paceQs = qOf('one_off').filter((q) => q.txnIds.some((id) => { const t = byId.get(id); return !!t && monthOf(t.date) === paceMonth && inScope(scope)(t); }));
  const pace: PaceData = {
    ...(paceDays < 7 ? locked(`${paceDays} of 7 days of ${monthName(paceMonth)} are on statements so far. The pace starts after a week.`)
      : paceBase == null ? locked('No complete month yet, so there is no forecast line to compare with.')
      : askIf(paceQs, (n) => `${plural(n, 'large charge')} this month may be one-time.`)),
    month: paceMonth, days: paceDays, daysInMonth: daysInMonth(paceMonth), daily, forecast: paceBase, spent: run,
    expectedByNow: paceBase != null ? Math.round((paceBase * paceDays) / daysInMonth(paceMonth)) : null,
  };

  // ---- Business ----------------------------------------------------------------------------------------------------------------------
  const bpQs = qOf('business_or_personal');
  const bizSpend = ctx.txns.filter((t) => isSpend(t) && t.business === true && inRange(t, dataFrom, dataTo));
  const waiting = uniq(bpQs);
  const allBills = recurringBasis(ctx.txns, ctx.recurring, dataTo).on;
  const toolRows: ToolRow[] = allBills.filter((i) => TOOL_CATEGORIES.has(i.category ?? '') || i.txnIds.some((id) => byId.get(id)?.hints?.includes('business_or_personal')))
    .map((i) => {
      const ts = i.txnIds.map((id) => byId.get(id)).filter((t): t is Txn => !!t);
      const confirmed = ts.length > 0 && ts.every((t) => t.business === true);
      const personalSaid = ts.some((t) => t.business === false);
      const hinted = ts.some((t) => t.hints?.includes('business_or_personal'));
      return { i, confirmed, personalSaid, hinted, qs: touching(bpQs, new Set(i.txnIds)) };
    })
    // a tool counts here when it is already business, or flagged as maybe business and not answered Personal
    .filter((r) => !r.personalSaid && (r.confirmed || r.hinted))
    .map((r) => ({ key: r.i.key, merchant: r.i.merchant, monthly: r.i.monthlyCents, yearly: r.i.monthlyCents * 12, confirmed: r.confirmed, questions: r.qs }))
    .sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || b.monthly - a.monthly);
  const undecided = toolRows.filter((r) => !r.confirmed).flatMap((r) => r.questions);
  const bizTools: BizToolsData = {
    ...(!anyData ? locked(NO_STATEMENT) : !toolRows.length ? locked('No repeating software or service charge looks like a business tool yet.', IMPORT)
      : undecided.length ? { readiness: 'answers', ask: { text: `${plural(toolRows.filter((r) => !r.confirmed).length, 'tool')} may be business. Mark them, or answer one by one in the Inbox.`, questionIds: undecided.map((q) => q.id) } } : ready()),
    rows: toolRows, undecided, monthly: toolRows.filter((r) => !r.confirmed).reduce((s, r) => s + r.monthly, 0), yearly: toolRows.reduce((s, r) => s + r.yearly, 0),
  };

  const bizIncomeTxns = ctx.txns.filter((t) => t.kind === 'income' && isBizIncome(t));
  const hasSource = bizIncomeTxns.length > 0;
  const bizAsk = (lead: string) => askIf(bpQs, (n) => `${plural(n, 'merchant')} ${n === 1 ? 'is' : 'are'} waiting for Business or Personal. ${lead}`);
  const bizSummary: BizSummaryData = {
    ...(!anyData ? locked(NO_STATEMENT) : !bizSpend.length && !bpQs.length ? locked('Nothing is tagged as business yet, and nothing is waiting for an answer.', { label: 'Open the Inbox', kind: 'inbox' }) : bizAsk('Your answers decide what counts.')),
    tagged: sum(bizSpend), waiting, toolsMonthly: bizTools.monthly, income: hasSource ? bizIncomeTxns.reduce((s, t) => s + t.cents, 0) : null, hasSource: businessSources.size > 0 && hasSource,
  };
  const pendingRows: BizPendingRow[] = bpQs.map((q) => ({ question: q, merchant: q.merchant, cents: uniq([q]), charges: q.txnIds.length })).sort((a, b) => b.cents - a.cents);
  const everHinted = ctx.txns.some((t) => t.hints?.includes('business_or_personal') || t.business !== undefined);
  const bizPending: BizPendingData = {
    ...(!anyData ? locked(NO_STATEMENT) : !everHinted ? locked('No charge has looked like a business expense yet.', { label: 'Open the Inbox', kind: 'inbox' }) : bizAsk('Each answer applies to every charge from that merchant.')),
    rows: pendingRows, total: waiting,
  };
  const top5 = pendingRows.slice(0, 5);
  const rest = pendingRows.slice(5).reduce((s, r) => s + r.cents, 0);
  const donutRows = [...top5.map((r) => ({ merchant: r.merchant, cents: r.cents })), ...(rest > 0 ? [{ merchant: 'Everything else', cents: rest }] : [])];
  const donutSum = donutRows.reduce((s, r) => s + r.cents, 0);
  const bizDonut: BizDonutData = { ...bizPending, slices: donutRows.map((r) => ({ ...r, share: donutSum > 0 ? r.cents / donutSum : 0 })), total: donutSum };

  const plMonths: PLMonth[] = fullList.map((m) => {
    const inc = bizIncomeTxns.filter((t) => monthOf(t.date) === m).reduce((s, t) => s + t.cents, 0);
    const sp = sum(bizSpend.filter((t) => monthOf(t.date) === m));
    return { month: m, income: inc, spend: sp, net: inc - sp };
  });
  const spendMonth = plMonths.some((m) => m.spend > 0);
  // only questions about charges in the months shown can change them
  const plQs = bpQs.filter((q) => q.txnIds.some((id) => { const t = byId.get(id); return !!t && complete.has(monthOf(t.date)); }));
  const bizPL: BizPLData = {
    ...(!hasSource ? locked('Business income is not connected: add a business income source, so its deposits are counted.', { label: 'Set up business income', kind: 'income' })
      : !spendMonth ? locked('No complete month has spending tagged as business yet.', { label: 'Answer business questions', kind: 'inbox' })
      : askIf(plQs, (n) => `${plural(n, 'merchant')} still ${n === 1 ? 'needs' : 'need'} Business or Personal, which changes these months.`)),
    months: plMonths, income: plMonths.reduce((s, m) => s + m.income, 0), spend: plMonths.reduce((s, m) => s + m.spend, 0), net: plMonths.reduce((s, m) => s + m.net, 0),
  };

  // ---- Keep it accurate -------------------------------------------------------------------------------------------------------------
  const attention: AttentionData = {
    ...(!hasAccounts ? locked(NO_STATEMENT) : ready()),
    count: questions.length, atStake: uniq(questions),
    top: [...questions].sort((a, b) => b.cents - a.cents).slice(0, 3).map((q) => ({ id: q.id, text: shortPrompt(q), cents: q.cents })),
    topCents: uniq([...questions].sort((a, b) => b.cents - a.cents).slice(0, 3)),
  };
  const { cardSide, bankSide, cardTotal } = unmatchedCardPayments(ctx.txns, ctx.accounts);
  const rangeDays = Math.max(1, (Date.parse(dataTo) - Date.parse(dataFrom)) / 86400000 + 1);
  const covRows: CoverageRow[] = spendAccounts(ctx.accounts).map((a) => {
    const iv = intervalsFor(a, ctx.statements).map((x) => ({ from: x.from < dataFrom ? dataFrom : x.from, to: x.to > dataTo ? dataTo : x.to })).filter((x) => x.from <= x.to);
    const covered = iv.reduce((s, x) => s + (Date.parse(x.to) - Date.parse(x.from)) / 86400000 + 1, 0);
    return { accountId: a.id, name: a.last4 ? `${a.name}` : a.name, from: a.coverage.from, to: a.coverage.to, coverage: iv, gaps: gaps(iv, dataFrom, dataTo), share: Math.min(1, covered / rangeDays) };
  });
  const dataHealth: DataHealthData = {
    ...(!hasAccounts ? locked('No account is connected yet.', { label: 'Import a statement', kind: 'import' }) : askIf(qOf('transfer_account'), (n) => `${plural(n, 'transfer')} went to an account that may be yours.`)),
    from: dataFrom, to: dataTo, accounts: covRows, unseenFunding: cardTotal, unseenCount: cardSide.length, missingCardStatements: bankSide.length, receiptsWaiting: input.receiptsWaiting,
  };

  return {
    kpis, cashflow, donut, trend, oneTime, cutIdeas, fixedFlex, subscriptions, grocery, bigbox, fuel,
    forecast, forecastBuild, pace, billsOnce, bizSummary, bizPending, bizDonut, bizTools, bizPL, attention, dataHealth,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------

function topMerchant(ts: Txn[]): { merchant: string; share: number } | null {
  const total = sum(ts);
  if (total <= 0) return null;
  const by = new Map<string, number>();
  for (const t of ts) by.set(t.merchant, (by.get(t.merchant) ?? 0) + out(t));
  const [merchant, cents] = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  return { merchant, share: cents / total };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];

/** Dollars for the dashboard's sentences: cents shown under $1,000, whole dollars above. */
export function money(cents: number, whole = Math.abs(cents) >= 100000): string {
  const v = Math.abs(cents) / 100;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${cents < 0 ? '-' : ''}$${s}`;
}

/** A round number at or above v, for a chart's scale. */
export function niceCeil(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * p;
}

function listNames(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** One line for a question in a short list. */
function shortPrompt(q: Question): string {
  switch (q.type) {
    case 'confirm_income': return q.txnIds.length > 1 ? `Is this pay? ${q.txnIds.length} deposits` : 'Is this deposit pay?';
    case 'business_or_personal': return `${q.merchant}: business or personal?`;
    case 'one_off': return `${q.merchant}: a one-time expense?`;
    case 'items': return `Add receipts for ${q.merchant}`;
    case 'transfer_account': return 'A transfer: to your own account?';
    case 'person_payment': return `${q.merchant.replace('Zelle: ', '')}: what was it for?`;
    default: return `${q.merchant}: which category?`;
  }
}

