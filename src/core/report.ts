import { CATEGORIES, categoryLabel, isCategoryId } from './categories';
import { MONTH_NAMES, addMonths, monthEnd, monthLabel, monthOf, monthStart, todayISO } from './dates';
import { forecastMonth } from './forecast';
import { dollars, runQuery, summarize } from './queries';
import type { Ctx, Filter, GroupBy, Metric, QuerySpec } from './queries';
import type { CategoryId } from './types';

// ---------------------------------------------------------------------------
// A report is DATA, not code. The model (or the offline planner) only writes a
// ReportSpec; the app runs every query itself, so every number on screen comes
// from the same engine as the dashboard. Nothing in a spec can execute code.
// ---------------------------------------------------------------------------

export type ChartKind = 'bars' | 'hbars' | 'line' | 'area' | 'stack' | 'donut';

export type Block =
  | { type: 'kpis'; items: { label: string; query: QuerySpec; note?: string }[] }
  | { type: 'chart'; chart: ChartKind; title: string; subtitle?: string; query: QuerySpec; stackBy?: GroupBy; stackLimit?: number }
  | { type: 'table'; title: string; kind: 'groups' | 'transactions'; query?: QuerySpec; filter?: Filter; limit?: number; order?: 'date_desc' | 'amount_desc' }
  | { type: 'forecast'; month: string }
  | { type: 'text'; title?: string; text: string };

export interface ReportSpec {
  title: string;
  subtitle?: string;
  period: { from: string; to: string; label: string };
  blocks: Block[];
  notes?: string[];
}

const METRICS: Metric[] = ['spend', 'income', 'rewards', 'net', 'transfers', 'count', 'average'];
const GROUPS: GroupBy[] = ['category', 'subcategory', 'merchant', 'month', 'week', 'day', 'account', 'weekday', 'need_want'];
const CHARTS: ChartKind[] = ['bars', 'hbars', 'line', 'area', 'stack', 'donut'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['spend', 'fee', 'refund', 'income', 'rewards', 'transfer'];

type R<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function cleanFilter(f: any, errs: string[]): Filter | undefined {
  if (f == null) return undefined;
  if (typeof f !== 'object') { errs.push('filter must be an object'); return undefined; }
  const out: Filter = {};
  for (const k of ['from', 'to'] as const) if (f[k] != null) { if (typeof f[k] === 'string' && ISO.test(f[k])) out[k] = f[k]; else errs.push(`filter.${k} must be YYYY-MM-DD`); }
  if (f.kinds) { if (Array.isArray(f.kinds) && f.kinds.every((k: any) => KINDS.includes(k))) out.kinds = f.kinds; else errs.push('filter.kinds invalid'); }
  if (f.categories) { if (Array.isArray(f.categories) && f.categories.every((c: any) => typeof c === 'string' && isCategoryId(c))) out.categories = f.categories as CategoryId[]; else errs.push('filter.categories must be known category ids'); }
  if (f.merchants) { if (Array.isArray(f.merchants) && f.merchants.every((m: any) => typeof m === 'string') && f.merchants.length <= 25) out.merchants = f.merchants; else errs.push('filter.merchants invalid'); }
  if (f.accounts) { if (Array.isArray(f.accounts) && f.accounts.every((m: any) => typeof m === 'string')) out.accounts = f.accounts; else errs.push('filter.accounts invalid'); }
  if (f.scope != null) { if (['all', 'personal', 'business'].includes(f.scope)) out.scope = f.scope; else errs.push('filter.scope invalid'); }
  if (f.text != null) { if (typeof f.text === 'string' && f.text.length <= 80) out.text = f.text; else errs.push('filter.text invalid'); }
  if (f.minCents != null) { if (Number.isFinite(f.minCents) && f.minCents >= 0) out.minCents = Math.floor(f.minCents); else errs.push('filter.minCents invalid'); }
  return out;
}

function cleanQuery(q: any, errs: string[], where: string): QuerySpec | undefined {
  if (!q || typeof q !== 'object') { errs.push(`${where}: query missing`); return undefined; }
  if (!METRICS.includes(q.metric)) { errs.push(`${where}: unknown metric "${q.metric}"`); return undefined; }
  const out: QuerySpec = { metric: q.metric };
  if (q.groupBy != null) { if (GROUPS.includes(q.groupBy)) out.groupBy = q.groupBy; else errs.push(`${where}: unknown groupBy "${q.groupBy}"`); }
  if (q.sort != null) { if (['value_desc', 'value_asc', 'key'].includes(q.sort)) out.sort = q.sort; else errs.push(`${where}: bad sort`); }
  if (q.limit != null) { if (Number.isInteger(q.limit) && q.limit >= 1 && q.limit <= 50) out.limit = q.limit; else errs.push(`${where}: limit must be 1 to 50`); }
  if (q.foldOther != null) out.foldOther = !!q.foldOther;
  const f = cleanFilter(q.filter, errs); if (f) out.filter = f;
  return out;
}

/** Validate one untrusted QuerySpec (used for model tool calls). */
export function validateQuerySpec(input: unknown): R<QuerySpec> {
  const errs: string[] = [];
  const v = cleanQuery(input, errs, 'query');
  return v && !errs.length ? { ok: true, value: v } : { ok: false, errors: errs.length ? errs : ['invalid query'] };
}
export function validateFilter(input: unknown): R<Filter> {
  const errs: string[] = [];
  const v = cleanFilter(input ?? {}, errs) ?? {};
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: v };
}

const str = (v: any, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Whitelist-validate untrusted JSON (from a model) into a ReportSpec. Unknown fields are dropped. */
export function validateReportSpec(input: unknown): R<ReportSpec> {
  const errs: string[] = [];
  const x = input as any;
  if (!x || typeof x !== 'object') return { ok: false, errors: ['spec must be an object'] };
  const title = str(x.title, 120); if (!title) errs.push('title required');
  const p = x.period;
  if (!p || !ISO.test(p.from ?? '') || !ISO.test(p.to ?? '') || p.from > p.to) errs.push('period.from/to must be ISO dates with from <= to');
  if (!Array.isArray(x.blocks) || x.blocks.length === 0 || x.blocks.length > 14) errs.push('blocks must have 1 to 14 entries');
  const blocks: Block[] = [];
  (Array.isArray(x.blocks) ? x.blocks : []).forEach((b: any, i: number) => {
    const w = `blocks[${i}]`;
    if (!b || typeof b !== 'object') { errs.push(`${w} invalid`); return; }
    if (b.type === 'kpis') {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 6).map((it: any, j: number) => { const q = cleanQuery(it?.query, errs, `${w}.items[${j}]`); const label = str(it?.label, 40); return q && label ? { label, query: q, note: str(it?.note, 80) } : null; }).filter(Boolean) as { label: string; query: QuerySpec; note?: string }[];
      if (!items.length) errs.push(`${w}: kpis needs items`); else blocks.push({ type: 'kpis', items });
    } else if (b.type === 'chart') {
      const q = cleanQuery(b.query, errs, w);
      if (!CHARTS.includes(b.chart)) errs.push(`${w}: unknown chart "${b.chart}"`);
      const t = str(b.title, 100); if (!t) errs.push(`${w}: title required`);
      if (b.stackBy != null && !GROUPS.includes(b.stackBy)) errs.push(`${w}: bad stackBy`);
      if (b.chart === 'stack' && !b.stackBy) errs.push(`${w}: stack chart needs stackBy`);
      if (q && CHARTS.includes(b.chart) && t) blocks.push({ type: 'chart', chart: b.chart, title: t, subtitle: str(b.subtitle, 160), query: q, stackBy: b.stackBy, stackLimit: Number.isInteger(b.stackLimit) ? Math.min(8, Math.max(2, b.stackLimit)) : undefined });
    } else if (b.type === 'table') {
      const t = str(b.title, 100); if (!t) errs.push(`${w}: title required`);
      if (b.kind !== 'groups' && b.kind !== 'transactions') errs.push(`${w}: kind must be groups or transactions`);
      const q = b.kind === 'groups' ? cleanQuery(b.query, errs, w) : undefined;
      const f = cleanFilter(b.filter, errs);
      if (t && (b.kind === 'transactions' || (b.kind === 'groups' && q))) blocks.push({ type: 'table', title: t, kind: b.kind, query: q, filter: f, limit: Number.isInteger(b.limit) ? Math.min(100, Math.max(1, b.limit)) : undefined, order: b.order === 'amount_desc' ? 'amount_desc' : 'date_desc' });
    } else if (b.type === 'forecast') {
      if (typeof b.month === 'string' && /^\d{4}-\d{2}$/.test(b.month)) blocks.push({ type: 'forecast', month: b.month }); else errs.push(`${w}: forecast.month must be YYYY-MM`);
    } else if (b.type === 'text') {
      const t = str(b.text, 1200); if (t) blocks.push({ type: 'text', title: str(b.title, 80), text: t }); else errs.push(`${w}: text required`);
    } else errs.push(`${w}: unknown block type "${b.type}"`);
  });
  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, value: { title: title!, subtitle: str(x.subtitle, 200), period: { from: p.from, to: p.to, label: str(p.label, 60) ?? `${p.from} to ${p.to}` }, blocks, notes: Array.isArray(x.notes) ? x.notes.map((n: any) => str(n, 200)).filter(Boolean).slice(0, 6) as string[] : undefined } };
}

// ---------------------------------------------------------------------------
// Stacked series (time x category) for stack charts
// ---------------------------------------------------------------------------
export interface StackResult { cols: { key: string; label: string; long: string }[]; series: { key: string; label: string; values: number[]; total: number }[] }

export function runStack(block: Extract<Block, { type: 'chart' }>, ctx: Ctx): StackResult {
  const base = runQuery({ ...block.query, sort: 'key', limit: undefined }, ctx);
  const cols = base.rows.map((r) => ({ key: r.key, label: r.label, long: r.long }));
  const limit = block.stackLimit ?? 5;
  const stackBy = block.stackBy ?? 'category';
  const perCol = cols.map((c) => runQuery({ ...block.query, groupBy: stackBy, sort: 'value_desc', limit: undefined, filter: { ...(block.query.filter ?? {}), ...colRange(block.query.groupBy, c.key, block.query.filter) } }, ctx));
  const totals = new Map<string, { label: string; total: number }>();
  for (const q of perCol) for (const r of q.rows) totals.set(r.key, { label: r.label, total: (totals.get(r.key)?.total ?? 0) + r.value });
  const ranked = [...totals.entries()].sort((a, b) => b[1].total - a[1].total);
  const keep = ranked.slice(0, limit).map(([k]) => k);
  const series = keep.map((k) => ({ key: k, label: totals.get(k)!.label, total: totals.get(k)!.total, values: perCol.map((q) => q.rows.find((r) => r.key === k)?.value ?? 0) }));
  if (ranked.length > limit) {
    const values = perCol.map((q) => q.rows.filter((r) => !keep.includes(r.key)).reduce((s, r) => s + r.value, 0));
    series.push({ key: '__other', label: 'Other', values, total: values.reduce((a, b) => a + b, 0) });
  }
  return { cols, series };
}
function colRange(g: GroupBy | undefined, key: string, f?: Filter): Filter {
  if (g === 'month') return { from: f?.from && f.from > monthStart(key) ? f.from : monthStart(key), to: f?.to && f.to < monthEnd(key) ? f.to : monthEnd(key) };
  if (g === 'week') { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return { from: key, to: d.toISOString().slice(0, 10) }; }
  if (g === 'day') return { from: key, to: key };
  return {};
}

// ---------------------------------------------------------------------------
// Offline planner: understands common phrasing without any model. The online
// agent produces the same ReportSpec shape, so the renderer never changes.
// ---------------------------------------------------------------------------
const CATEGORY_WORDS: [RegExp, CategoryId][] = [
  [/\b(fuel|gas|gasoline|petrol)\b/i, 'fuel'], [/\bgrocer(y|ies)\b|\bfood shopping\b/i, 'groceries'], [/\bmedical|doctor|health ?care|lab\b/i, 'medical'],
  [/\bcar (maintenance|repair)|\bauto\b|\bmaintenance\b/i, 'auto'], [/\bhousehold\b|\bsupplies\b/i, 'household'], [/\bclothing|clothes|shoes\b/i, 'clothing'],
  [/\brestaurants?|dining|eating out\b/i, 'restaurants'], [/\binsurance\b/i, 'insurance'], [/\bphone\b|\butilities\b/i, 'phone'],
  [/\bsubscriptions?|software\b/i, 'subscriptions'], [/\btravel|trip\b/i, 'travel'], [/\beducation|school|kids?|childcare\b/i, 'education'],
  [/\bgiving|donations?|charity\b/i, 'giving'], [/\bonline shopping|amazon\b/i, 'online_shopping'], [/\bwalmart|sam'?s|costco|big-box\b/i, 'mixed_retail'],
];

export function parsePeriod(text: string, today: string, dataFrom: string, dataTo: string): { from: string; to: string; label: string } {
  const t = text.toLowerCase();
  const cur = monthOf(today);
  const year = Number(today.slice(0, 4));
  const monthIdx = (s: string) => MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(s.slice(0, 3)));
  const ym = (i: number, y = year) => `${y}-${String(i + 1).padStart(2, '0')}`;
  const names = MONTH_NAMES.map((m) => m.toLowerCase());
  const range = t.match(new RegExp(`(${names.join('|')})\\w*\\s*(?:to|through|until|-|and)\\s*(${names.join('|')})`));
  if (range) { const a = ym(monthIdx(range[1])), b = ym(monthIdx(range[2])); return { from: monthStart(a), to: monthEnd(b), label: `${monthLabel(a, true)} to ${monthLabel(b)}` }; }
  if (/last month|previous month/.test(t)) { const m = addMonths(cur, -1); return { from: monthStart(m), to: monthEnd(m), label: monthLabel(m) }; }
  if (/this month|current month|so far this month/.test(t)) return { from: monthStart(cur), to: monthEnd(cur), label: monthLabel(cur) };
  const lastN = t.match(/last (\d+) months?/); if (lastN) { const a = addMonths(cur, -Number(lastN[1])); const b = addMonths(cur, -1); return { from: monthStart(a), to: monthEnd(b), label: `Last ${lastN[1]} months` }; }
  const q = t.match(/\bq([1-4])\b/); if (q) { const s = (Number(q[1]) - 1) * 3; return { from: monthStart(ym(s)), to: monthEnd(ym(s + 2)), label: `Q${q[1]} ${year}` }; }
  if (/year to date|ytd|this year/.test(t)) return { from: `${year}-01-01`, to: today, label: `${year} so far` };
  const one = t.match(new RegExp(`\\b(${names.join('|')})\\b(?:\\s+(20\\d\\d))?`));
  if (one) { const y = one[2] ? Number(one[2]) : year; const m = ym(monthIdx(one[1]), y); return { from: monthStart(m), to: monthEnd(m), label: monthLabel(m) }; }
  return { from: dataFrom, to: dataTo, label: `${monthLabel(monthOf(dataFrom), true)} to ${monthLabel(monthOf(dataTo))}` };
}

export function planReport(text: string, ctx: Ctx, today = todayISO()): ReportSpec {
  const dates = ctx.txns.map((t) => t.date).sort();
  const dataFrom = dates[0] ?? today, dataTo = dates[dates.length - 1] ?? today;
  const period = parsePeriod(text, today, dataFrom, dataTo);
  const filter: Filter = { from: period.from, to: period.to };
  const cats = CATEGORY_WORDS.filter(([re]) => re.test(text)).map(([, c]) => c);
  const multiMonth = monthOf(period.from) !== monthOf(period.to);
  const wantsIncome = /\b(earn|income|salary|paid|net|cash ?flow|save|saved)\b/i.test(text);
  const wantsForecast = /\b(forecast|predict|projection|next month|expect|will i spend)\b/i.test(text);
  const wantsStores = /\b(store|stores|merchant|where|shop)\b/i.test(text);
  const wantsNeedsWants = /\bneeds?\b.*\bwants?\b|\bwants?\b.*\bneeds?\b/i.test(text);
  const blocks: Block[] = [];
  const spend = (extra?: Filter): QuerySpec => ({ metric: 'spend', filter: { ...filter, ...extra } });

  if (cats.length) {
    const cf: Filter = { ...filter, categories: cats };
    const label = cats.map(categoryLabel).join(' and ');
    blocks.push({ type: 'kpis', items: [
      { label: `${label} spent`, query: { metric: 'spend', filter: cf } },
      { label: 'Purchases', query: { metric: 'count', filter: cf } },
      { label: 'Average purchase', query: { metric: 'average', filter: cf } },
    ] });
    if (multiMonth) blocks.push({ type: 'chart', chart: 'bars', title: `${label} by month`, query: { metric: 'spend', groupBy: 'month', filter: cf } });
    else blocks.push({ type: 'chart', chart: 'line', title: `${label} by week`, query: { metric: 'spend', groupBy: 'week', filter: cf } });
    blocks.push({ type: 'chart', chart: 'hbars', title: `Where the ${label.toLowerCase()} money went`, query: { metric: 'spend', groupBy: 'merchant', filter: cf, limit: 10, foldOther: true } });
    blocks.push({ type: 'table', title: `All ${label.toLowerCase()} transactions`, kind: 'transactions', filter: { ...cf, kinds: ['spend', 'fee', 'refund'] }, limit: 50, order: 'date_desc' });
  } else {
    const items = [{ label: 'Spent', query: spend() }];
    if (wantsIncome) items.unshift({ label: 'Earned', query: { metric: 'income', filter } }, { label: 'Rewards', query: { metric: 'rewards', filter } });
    blocks.push({ type: 'kpis', items });
    if (wantsIncome) blocks.push({ type: 'chart', chart: 'bars', title: 'Earned minus spent, by month', subtitle: 'Only deposits to the connected accounts count as earned.', query: { metric: 'net', groupBy: 'month', filter } });
    if (multiMonth) blocks.push({ type: 'chart', chart: 'stack', title: 'Spending by month and category', query: { metric: 'spend', groupBy: 'month', filter }, stackBy: 'category', stackLimit: 5 });
    else blocks.push({ type: 'chart', chart: 'area', title: 'Spending by week', query: { metric: 'spend', groupBy: 'week', filter } });
    blocks.push({ type: 'chart', chart: 'hbars', title: 'Spending by category', query: { metric: 'spend', groupBy: 'category', filter, limit: 10, foldOther: true } });
    if (wantsNeedsWants) blocks.push({ type: 'chart', chart: 'donut', title: 'Needs, wants and unsplit', subtitle: 'Big-box and online baskets stay unsplit until receipts add item detail.', query: { metric: 'spend', groupBy: 'need_want', filter } });
    if (wantsStores || !wantsIncome) blocks.push({ type: 'chart', chart: 'hbars', title: 'Top stores', query: { metric: 'spend', groupBy: 'merchant', filter, limit: 10, foldOther: true } });
    blocks.push({ type: 'table', title: 'Largest purchases', kind: 'transactions', filter: { ...filter, kinds: ['spend', 'fee'] }, limit: 10, order: 'amount_desc' });
  }
  if (wantsForecast) blocks.push({ type: 'forecast', month: addMonths(monthOf(today), 0) });

  const s = summarize(ctx, period.from, period.to);
  const notes: string[] = [];
  if (s.partialAccounts.length) notes.push(`Statements for ${s.partialAccounts.map((a) => `${a.name} (through ${a.coveredTo})`).join(', ')} end before ${period.to}. Totals for the last days of this period are incomplete.`);
  if (wantsIncome && s.incomeIncomplete) notes.push('Earned only includes deposits into the connected checking account. Add your other accounts to see all income.');
  return { title: cats.length ? `${cats.map(categoryLabel).join(' and ')}: ${period.label}` : `Spending report: ${period.label}`, subtitle: `Built from your request: "${text.trim().slice(0, 120)}"`, period, blocks, notes };
}

export interface Answer { text: string; report?: ReportSpec }

/** Plain-language answer from the same engine. The model-backed agent replaces this and returns the same shape. */
export function answer(text: string, ctx: Ctx, today = todayISO()): Answer {
  const report = planReport(text, ctx, today);
  const { from, to, label } = report.period;
  const cats = CATEGORY_WORDS.filter(([re]) => re.test(text)).map(([, c]) => c);
  const f: Filter = { from, to, ...(cats.length ? { categories: cats } : {}) };
  const spent = runQuery({ metric: 'spend', filter: f }, ctx);
  const s = summarize(ctx, from, to);
  const parts: string[] = [];
  if (/\b(forecast|predict|next month|expect|will i spend)\b/i.test(text)) {
    const fc = forecastMonth(ctx, monthOf(today), today);
    parts.push(`I expect about ${dollars(fc.total, { decimals: false })} for ${monthLabel(fc.month)} (likely range ${dollars(fc.low, { decimals: false })} to ${dollars(fc.high, { decimals: false })}). ${fc.caveat}`);
  } else if (/\b(earn|income|salary)\b/i.test(text)) {
    parts.push(`Earned in ${label}: ${dollars(s.earned)} from income deposits, plus ${dollars(s.rewards)} in rewards (kept separate).`);
    if (s.unconfirmedIncome) parts.push(`${dollars(s.unconfirmedIncome)} of that is not confirmed yet, because the bank statement hides who sent it.`);
  } else {
    const what = cats.length ? cats.map(categoryLabel).join(' and ').toLowerCase() : 'everything';
    parts.push(`${what[0].toUpperCase() + what.slice(1)} in ${label}: ${dollars(spent.total)} across ${spent.count} purchase${spent.count === 1 ? '' : 's'}.`);
    const top = runQuery({ metric: 'spend', groupBy: cats.length ? 'merchant' : 'category', filter: f, limit: 3 }, ctx).rows;
    if (top.length) parts.push(`Biggest: ${top.map((r) => `${r.label} ${dollars(r.value)}`).join(', ')}.`);
  }
  if (s.partialAccounts.length) parts.push(`Note: ${s.partialAccounts.map((a) => a.name).join(', ')} statements stop before ${to}, so the latest days may be missing.`);
  return { text: parts.join(' '), report };
}

export { CATEGORIES };
