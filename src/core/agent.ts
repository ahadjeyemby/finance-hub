import { monthLabel } from './dates';
import { forecastMonth } from './forecast';
import { dollars, listTxns, runQuery, summarize } from './queries';
import type { Ctx } from './queries';
import { SPENDING_METRICS, answer, notSpendingOnly, validateFilter, validateQuerySpec, validateReportSpec } from './report';
import type { ReportSpec } from './report';

// ---------------------------------------------------------------------------
// The agent never touches data directly and never runs model-written code.
// It can call five fixed, read-only tools; every tool runs here, on the device,
// against the same query engine as the dashboard. The model sits behind a thin
// proxy (supabase/functions/ask) that only holds the API key.
// ---------------------------------------------------------------------------
export interface AgentResult { text: string; report?: ReportSpec; source: 'model' | 'offline'; note?: string }
export interface AgentEnv {
  today: string; dataFrom: string; dataTo: string; scope: 'all' | 'personal' | 'business';
  /** a Contributor (migration 0010): the data is spending only, and the tools, the instructions and every answer speak only of spending */
  spendingOnly?: boolean;
}

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
export type Post = (body: { system: string; tools: unknown[]; messages: Msg[] }) => Promise<{ content: Block[]; stop_reason: string }>;

export const TOOLS = [
  { name: 'query', description: 'Run one aggregate query over the ledger. Amounts are integer cents. Spending excludes transfers, card payments and business items when scope is personal.', input_schema: { type: 'object', properties: { metric: { type: 'string', enum: ['spend', 'income', 'rewards', 'net', 'transfers', 'count', 'average'] }, groupBy: { type: 'string', enum: ['category', 'subcategory', 'merchant', 'month', 'week', 'day', 'account', 'weekday', 'need_want'] }, filter: { type: 'object' }, sort: { type: 'string', enum: ['value_desc', 'value_asc', 'key'] }, limit: { type: 'integer' } }, required: ['metric'] } },
  { name: 'transactions', description: 'List individual transactions matching a filter (max 40).', input_schema: { type: 'object', properties: { filter: { type: 'object' }, limit: { type: 'integer' }, order: { type: 'string', enum: ['date_desc', 'amount_desc'] } }, required: ['filter'] } },
  { name: 'summary', description: 'Earned, rewards, spent, net and data-coverage warnings for a date range.', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'forecast', description: 'Rule-based spending forecast for a month (YYYY-MM).', input_schema: { type: 'object', properties: { month: { type: 'string' } }, required: ['month'] } },
  { name: 'make_report', description: 'Show the person an interactive report. Blocks: kpis, chart (bars|hbars|line|area|stack|donut), table, forecast, text. Call at most once, last.', input_schema: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] } },
];

/** A Contributor's tools: the same five, with spending the only thing a query or summary can be about. */
const SPENDING_TOOLS = TOOLS.map((t) => {
  if (t.name === 'query') return { ...t, description: 'Run one aggregate query over the household spending. Amounts are integer cents.', input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, metric: { type: 'string', enum: SPENDING_METRICS } } } };
  if (t.name === 'summary') return { ...t, description: 'Spent, and data-coverage warnings, for a date range.' };
  return t;
});
export const toolsFor = (e: AgentEnv) => (e.spendingOnly ? SPENDING_TOOLS : TOOLS);

const spendingSystem = (e: AgentEnv) => `You answer questions about a household's spending using ONLY the tools. Never guess a number.
Today is ${e.today}. Data runs ${e.dataFrom} to ${e.dataTo}.
The data is spending, refunds and fees. Talk only about spending. If asked about anything else, say you can only answer questions about spending.
If a result carries a data warning (partial statements), say so plainly. Reply briefly in plain language. Offer a report with make_report when the person asks for charts or a report.
Filter fields: from, to (YYYY-MM-DD), categories, merchants, accounts, text, minCents.`;

export const system = (e: AgentEnv) => (e.spendingOnly ? spendingSystem(e) : `You answer questions about one person's finances using ONLY the tools. Never guess a number.
Today is ${e.today}. Data runs ${e.dataFrom} to ${e.dataTo}. Scope: ${e.scope}.
Rules: credit-card payments and moves between the person's own accounts are never spending or income. Only deposits into checking or savings count as earned; rewards are tracked apart.
If a result carries a data warning (partial statements, unconfirmed income), say so plainly. Reply briefly in plain language. Offer a report with make_report when the person asks for charts or a report.
Filter fields: from, to (YYYY-MM-DD), kinds, categories, merchants, accounts, scope, text, minCents.`);

type Out = { content: string; error?: boolean; report?: ReportSpec };

export function runTool(name: string, input: any, ctx: Ctx, env: AgentEnv): Out {
  const scopeIt = (f: any) => ({ ...(f ?? {}), ...(env.scope !== 'all' ? { scope: env.scope } : {}) });
  try {
    if (name === 'query') {
      const v = validateQuerySpec({ ...input, filter: scopeIt(input?.filter) });
      if (!v.ok) return { content: `Invalid query: ${v.errors.join('; ')}`, error: true };
      if (env.spendingOnly && !SPENDING_METRICS.includes(v.value.metric)) return { content: 'Only spending can be asked about.', error: true };
      const r = runQuery(v.value, ctx);
      return { content: JSON.stringify({ total: r.total, count: r.count, rows: r.rows.slice(0, 40).map((x) => ({ key: x.key, label: x.long, value: x.value, count: x.count })) }) };
    }
    if (name === 'transactions') {
      const v = validateFilter(scopeIt(input?.filter));
      if (!v.ok) return { content: `Invalid filter: ${v.errors.join('; ')}`, error: true };
      const rows = listTxns(ctx, v.value, Math.min(40, Math.max(1, Number(input?.limit) || 20)), input?.order === 'amount_desc' ? 'amount_desc' : 'date_desc');
      return { content: JSON.stringify(rows.map((t) => ({ date: t.date, merchant: t.merchant, cents: t.cents, kind: t.kind, category: t.category, business: t.business ?? false, items: t.lines?.length }))) };
    }
    if (name === 'summary') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(input?.to ?? '')) return { content: 'from and to must be YYYY-MM-DD', error: true };
      const s = summarize(ctx, input.from, input.to, env.scope);
      return { content: JSON.stringify(env.spendingOnly ? { from: s.from, to: s.to, spent: s.spent, partialAccounts: s.partialAccounts } : s) };
    }
    if (name === 'forecast') {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? '')) return { content: 'month must be YYYY-MM', error: true };
      const f = forecastMonth(ctx, input.month, env.dataTo);
      return { content: JSON.stringify({ month: monthLabel(f.month), total: f.total, low: f.low, high: f.high, confidence: f.confidence, caveat: f.caveat, recurring: f.recurring.slice(0, 10), oneOffsExcluded: f.oneOffsExcluded }) };
    }
    if (name === 'make_report') {
      const v = validateReportSpec(input?.spec);
      if (!v.ok) return { content: `Invalid report: ${v.errors.join('; ')}`, error: true };
      const off = env.spendingOnly ? notSpendingOnly(v.value) : [];
      if (off.length) return { content: `Invalid report: ${off.join('; ')}`, error: true };
      return { content: 'Report shown to the person.', report: v.value };
    }
    return { content: `Unknown tool ${name}`, error: true };
  } catch (e) {
    return { content: `Tool failed: ${(e as Error).message}`, error: true };
  }
}

export async function runAgent(question: string, ctx: Ctx, env: AgentEnv, post: Post, maxSteps = 6): Promise<AgentResult> {
  const messages: Msg[] = [{ role: 'user', content: question }];
  let report: ReportSpec | undefined;
  for (let step = 0; step < maxSteps; step++) {
    const res = await post({ system: system(env), tools: toolsFor(env), messages });
    const text = res.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
    const uses = res.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!uses.length) return { text: text || 'I could not find an answer.', report, source: 'model' };
    messages.push({ role: 'assistant', content: res.content });
    const results: Block[] = uses.map((u) => { const o = runTool(u.name, u.input, ctx, env); if (o.report) report = o.report; return { type: 'tool_result', tool_use_id: u.id, content: o.content.slice(0, 8000), is_error: o.error }; });
    messages.push({ role: 'user', content: results });
  }
  return { text: 'That took too many steps. Try a narrower question.', report, source: 'model' };
}

/** Model-backed when a proxy is configured, otherwise (or on any failure) the offline planner. */
export async function askAgent(question: string, ctx: Ctx, env: AgentEnv, post?: Post): Promise<AgentResult> {
  if (post) {
    try { return await runAgent(question, ctx, env, post); }
    catch (e) { const a = answer(question, ctx, env.today, env); return { ...a, source: 'offline', note: `The assistant model could not be reached (${(e as Error).message}). This answer comes from the built-in planner.` }; }
  }
  const a = answer(question, ctx, env.today, env);
  return { ...a, source: 'offline' };
}
export { dollars };
