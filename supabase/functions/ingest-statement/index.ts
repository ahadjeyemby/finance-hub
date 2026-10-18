// Reads a bank or card statement (PDF or page photo) and returns the header details and every transaction row.
// Nothing is saved here. The app checks the rows against the printed balances, asks about anything missing
// or inconsistent, and saves only after the person confirms.
import { cors, json, requireUser } from '../_shared/auth.ts';
import { callModel } from '../_shared/model.ts';

const tool = {
  name: 'record_statement',
  description: 'Record the statement exactly as printed. Never invent, balance or correct figures. If something is not printed or not legible, leave it out.',
  input_schema: {
    type: 'object',
    properties: {
      institution: { type: 'string', description: 'bank or card issuer name as printed' },
      product: { type: 'string', description: 'account or card product name as printed, e.g. "Advantage Plus Banking", "Freedom Unlimited"' },
      last4: { type: 'string', description: 'last four digits of the account or card number' },
      account_type: { type: 'string', enum: ['checking', 'savings', 'credit'], description: 'credit = a credit card statement' },
      period_from: { type: 'string', description: 'first day of the statement period, YYYY-MM-DD' },
      period_to: { type: 'string', description: 'last day of the statement period, YYYY-MM-DD' },
      statement_date: { type: 'string', description: 'closing or issue date, YYYY-MM-DD' },
      due_date: { type: 'string', description: 'payment due date, YYYY-MM-DD (cards)' },
      opening_balance: { type: 'number', description: 'dollars. Bank: balance at the start. Credit card: previous balance owed, as a positive number.' },
      closing_balance: { type: 'number', description: 'dollars. Bank: balance at the end. Credit card: new balance owed, as a positive number.' },
      totals: { type: 'object', additionalProperties: { type: 'number' }, description: 'every summary figure printed, in dollars, positive: e.g. purchases, payments, fees, interest, deposits, withdrawals, cash_advances' },
      terms: { type: 'object', additionalProperties: true, description: 'printed terms: apr, minimum_payment, credit_limit, available_credit, rewards_balance, interest_rate_on_savings, and similar' },
      pages: { type: 'number' },
      rewards: {
        type: 'object',
        description: 'Points or cash-back details. Anything printed in a rewards or points section goes here and NOT in rows: a points summary, and any table with a Rewards or Points column such as "Purchases and redemptions" or "Returns and other credits" paid or restored with points. These lines do not change the balance owed.',
        properties: {
          summary: { type: 'array', description: 'every line of the points summary in order, label exactly as printed including any leading + or -, points as a signed number as printed', items: { type: 'object', properties: { label: { type: 'string' }, points: { type: 'number' } }, required: ['label', 'points'] } },
          points_available: { type: 'number', description: 'the printed total points available for redemption' },
          activity: {
            type: 'array',
            description: 'each line of a points table: what was paid for with points, and credits that gave points back',
            items: { type: 'object', properties: {
              date: { type: 'string', description: 'YYYY-MM-DD' },
              description: { type: 'string', description: 'exactly as printed' },
              amount: { type: 'number', description: 'dollars as printed: positive for a purchase or redemption, negative for a return or credit' },
              points: { type: 'number', description: 'the points printed beside it' },
              type: { type: 'string', enum: ['purchase', 'redemption', 'return'] },
            }, required: ['description', 'amount'] },
          },
        },
      },
      rows: {
        type: 'array',
        description: 'every line that changes the balance owed or held, in order, from every page, including fees, interest and payments. Lines from a points or rewards table are not rows: put them in rewards.activity.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD. Statements often print MM/DD: take the year from the statement period (a January row on a statement that ends in January belongs to that year; a December row belongs to the previous year).' },
            description: { type: 'string', description: 'description exactly as printed' },
            amount: { type: 'number', description: 'dollars, always positive' },
            flow: { type: 'string', enum: ['out', 'in'], description: 'out = money leaving the account or added to the amount owed (withdrawals, purchases, fees, interest). in = money arriving or reducing the amount owed (deposits, payments, refunds, credits).' },
            section: { type: 'string', description: 'heading the row sits under, e.g. Purchases, Payments and Credits, Deposits, Withdrawals' },
          },
          required: ['description', 'amount', 'flow'],
        },
      },
      other_text: { type: 'string', description: 'anything else printed that is worth keeping: rewards activity, notices, fee explanations' },
      unreadable: { type: 'string', description: 'anything you could not read' },
    },
    required: ['rows'],
  },
};

const IMAGE = /^image\/(jpeg|png|webp)$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const denied = await requireUser(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const data: unknown = body.file_base64;
  const type: string = body.media_type ?? '';
  const isPdf = type === 'application/pdf';
  if (typeof data !== 'string' || data.length > 14_000_000 || !(IMAGE.test(type) || isPdf)) return json({ error: 'send a pdf, jpeg, png or webp under 10 MB' }, 400);
  const file = isPdf
    ? { type: 'document' as const, filename: typeof body.filename === 'string' ? body.filename.slice(0, 120) : 'statement.pdf', source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: type, data } };
  const r = await callModel({
    max_tokens: 12000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'record_statement' },
    messages: [{ role: 'user', content: [
      file,
      { type: 'text', text: 'Read this statement with record_statement. List every transaction row on every page, none skipped or merged. Copy descriptions and amounts exactly as printed. Do not make the rows add up: report what is printed and nothing else. If the statement has a points or rewards summary or a table with a Rewards or Points column, report it in `rewards` and keep those lines out of `rows`.' },
    ] }],
  }, 'vision');
  if (!r.ok) return r;
  const out = await r.json();
  const use = out.content?.find((b: { type: string }) => b.type === 'tool_use');
  // a cut-off answer has unusable arguments: say so plainly rather than returning half a statement
  if (out.stop_reason === 'max_tokens' || !use || use.input?.__invalid_arguments) {
    return json({ error: 'The statement is too long to read in one pass, or the reader stopped early. Split the PDF by month, or load it with the desktop script (bun run ledger).' }, 422);
  }
  return json(use.input);
});
