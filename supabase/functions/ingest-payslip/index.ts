// Reads a pay slip (a PDF, a photo or a screenshot of a payroll portal) and returns what is printed: pay date, gross, each tax, each deduction,
// net pay and where it was deposited. Nothing is saved here and nothing is corrected. The app puts the reading into the pay record form, shows
// whether it adds up, and saves only after the person has checked it against the slip.
import { cors, json, requireUser } from '../_shared/auth.ts';
import { callModel, isReaderAllowed, readerChoices } from '../_shared/model.ts';

const money = (description: string) => ({ type: 'number', description });
const tool = {
  name: 'record_payslip',
  description: 'Record the pay slip exactly as printed. Never invent, balance or correct figures. If something is not printed or not legible, leave it out.',
  input_schema: {
    type: 'object',
    properties: {
      employer: { type: 'string', description: 'employer or payer name as printed, if shown' },
      pay_date: { type: 'string', description: 'the date the money was paid (check date, pay date), YYYY-MM-DD. A date at the top of a payroll portal page is usually this.' },
      period_from: { type: 'string', description: 'first day of the pay period, YYYY-MM-DD, if printed' },
      period_to: { type: 'string', description: 'last day of the pay period, YYYY-MM-DD, if printed' },
      gross: money('gross pay for this pay date in dollars, before anything is taken out'),
      net: money('net pay, take-home, in dollars'),
      earnings: { type: 'array', description: 'the lines that make up gross (regular, overtime, bonus), as printed', items: { type: 'object', properties: { label: { type: 'string' }, amount: money('dollars, positive') }, required: ['label', 'amount'] } },
      taxes: {
        type: 'array', description: 'every tax taken out of this pay: federal, Social Security, Medicare, state, local, disability. One entry each, label as printed, amount positive even if the slip shows a minus sign.',
        items: { type: 'object', properties: { label: { type: 'string' }, amount: money('dollars, positive') }, required: ['label', 'amount'] },
      },
      deductions: {
        type: 'array', description: 'every other amount taken out of this pay that is not a tax: insurance premiums, retirement contributions, garnishments, union dues. One entry each, label as printed, amount positive.',
        items: { type: 'object', properties: { label: { type: 'string' }, amount: money('dollars, positive'), group: { type: 'string', enum: ['insurance', 'retirement', 'other'], description: 'insurance = health, dental, vision or life premiums; retirement = 401(k), pension, IRA; other = anything else' } }, required: ['label', 'amount'] },
      },
      deposits: {
        type: 'array', description: 'where the net pay was sent: one entry per account, with the last four digits of the account number if shown and the amount',
        items: { type: 'object', properties: { last4: { type: 'string', description: 'last four digits only' }, amount: money('dollars, positive') }, required: ['amount'] },
      },
      other_text: { type: 'string', description: 'anything else printed that is worth keeping: year-to-date totals, hours, notices' },
      unreadable: { type: 'string', description: 'anything you could not read' },
    },
    required: ['gross', 'net'],
  },
};

/** The same fields as plain JSON text: used when the tool call comes back unusable, and when a second reading is asked for. */
const JSON_PROMPT = 'Read this pay slip. Reply with ONE JSON object and nothing else, in this shape (leave out any field that is not printed): '
  + '{"employer": str, "pay_date": "YYYY-MM-DD", "period_from": "YYYY-MM-DD", "period_to": "YYYY-MM-DD", "gross": number, "net": number, '
  + '"earnings": [{"label": str, "amount": number}], "taxes": [{"label": str, "amount": number}], '
  + '"deductions": [{"label": str, "amount": number, "group": "insurance"|"retirement"|"other"}], "deposits": [{"last4": str, "amount": number}], "other_text": str, "unreadable": str}. '
  + 'Amounts are dollars exactly as printed, always positive (a slip may show taxes and deductions with a minus sign: drop the sign). '
  + 'taxes holds every tax taken out, one entry each; deductions holds every other amount taken out that is not a tax. deposits is where the net pay was sent, one entry per account, with only the last four digits of the account number. '
  + 'Report only what is printed: never make the figures add up.';

const TEXT = 'Read this pay slip with record_payslip. Report gross pay, every tax and every other deduction as separate entries, net pay, and each deposit (account last four digits and amount). Copy labels and amounts exactly as printed; amounts positive. Do not make the figures add up: report what is printed and nothing else.';

/** The first JSON object in a model's text, however it is wrapped. null if there is none. */
function firstJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start !== -1 && start < text.length; start = text.indexOf('{', start + 1)) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) {
        try { const v = JSON.parse(text.slice(start, i + 1)); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* try the next brace */ }
        break;
      }
    }
  }
  return null;
}

const IMAGE = /^image\/(jpeg|png|webp)$/;
const FAILED = 'The reader could not produce a complete answer for this file. Try a clearer photo or a smaller PDF, or type the pay record by hand.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const denied = await requireUser(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (body.action === 'models') return json(readerChoices());
  const choice: string | undefined = body.model === undefined || body.model === null || body.model === '' ? undefined : body.model;
  if (choice !== undefined && !isReaderAllowed(choice)) return json({ error: 'That reader is not on the allowed list. Add it to OPENROUTER_MODEL_CHOICES first.' }, 400);
  const data: unknown = body.file_base64;
  const type: string = body.media_type ?? '';
  const isPdf = type === 'application/pdf';
  if (typeof data !== 'string' || data.length > 14_000_000 || !(IMAGE.test(type) || isPdf)) return json({ error: 'send a pdf, jpeg, png or webp under 10 MB' }, 400);
  const file = isPdf
    ? { type: 'document' as const, filename: typeof body.filename === 'string' ? body.filename.slice(0, 120) : 'payslip.pdf', source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: type, data } };

  const plain = async (purpose: 'vision' | 'verify') => {
    const r = await callModel({ max_tokens: 3000, messages: [{ role: 'user', content: [file, { type: 'text', text: JSON_PROMPT }] }] }, purpose, choice);
    if (!r.ok) return r;
    const out = await r.json();
    const text = (out.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text?: string }) => b.text ?? '').join('');
    const parsed = firstJsonObject(text);
    if (!parsed || (parsed.gross === undefined && parsed.net === undefined)) return json({ error: FAILED }, 422);
    return json({ ...parsed, read_by: r.headers.get('x-model') ?? undefined });
  };

  // a second reading, or a reader the person chose, is read as plain JSON
  if (body.second_opinion === true || choice) return await plain('verify');

  const r = await callModel({
    max_tokens: 3000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'record_payslip' },
    messages: [{ role: 'user', content: [file, { type: 'text', text: TEXT }] }],
  }, 'vision');
  if (!r.ok) return r;
  const out = await r.json();
  const use = out.content?.find((b: { type: string }) => b.type === 'tool_use');
  // an unusable tool call is retried once as plain JSON, which some layouts read better
  if (!use || use.input?.__invalid_arguments) return await plain('vision');
  return json({ ...use.input, read_by: r.headers.get('x-model') ?? undefined });
});
