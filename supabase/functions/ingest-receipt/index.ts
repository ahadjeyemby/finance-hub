// Reads a receipt (photo or PDF) and returns everything printed on it for the person to review.
// Nothing is saved here: the app analyses the result, asks about anything missing, and saves only after confirmation.
import { cors, json, requireUser } from '../_shared/auth.ts';
import { callModel, isReaderAllowed, readerChoices } from '../_shared/model.ts';

const tool = {
  name: 'record_receipt',
  description: 'Record everything printed on the receipt or order confirmation. Copy values exactly as printed. If a value is not legible or not printed, leave it out instead of guessing.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['store_receipt', 'order_confirmation', 'order_history'], description: 'store_receipt = printed at the till; order_confirmation = an online order summary; order_history = a list page from an account' },
      merchant: { type: 'string' },
      store_address: { type: 'string' },
      store_ref: { type: 'string', description: 'store, register or terminal number as printed' },
      order_ref: { type: 'string', description: 'order number or invoice number as printed' },
      date: { type: 'string', description: 'YYYY-MM-DD. Use the printed year; if the year is not printed leave this out.' },
      time: { type: 'string', description: 'time of purchase as printed' },
      subtotal: { type: 'number', description: 'dollars, before tax' },
      tax: { type: 'number', description: 'total sales tax, dollars' },
      tip: { type: 'number', description: 'dollars' },
      discount: { type: 'number', description: 'receipt-level discount or coupon total, dollars, positive' },
      charges: {
        type: 'array',
        description: 'Every other charge added between the items and the total, apart from sales tax and tip: a service charge, delivery or bag fee, surcharge, automatic gratuity, and so on. One entry each, as printed. Leave out if there are none.',
        items: { type: 'object', properties: { label: { type: 'string', description: 'as printed, e.g. "Service Charge (2.0%)"' }, amount: { type: 'number', description: 'dollars, positive' }, rate: { type: 'number', description: 'the printed percentage, e.g. 2 for 2.0%, if one is shown' }, type: { type: 'string', enum: ['service', 'delivery', 'fee', 'surcharge', 'gratuity', 'bag', 'other'] } }, required: ['label', 'amount'] },
      },
      total: { type: 'number', description: 'amount charged to the card or paid, dollars. If part of the order was paid with points, a gift card or store credit, this is the card part (Amazon: the Grand Total), not the order total.' },
      paid_other: { type: 'number', description: 'dollars, positive: the part of the order paid with points, a gift card, store credit or a promotional balance instead of the card, e.g. Amazon "Rewards Points: -$20.24". Leave out if none.' },
      paid_other_label: { type: 'string', description: 'what it was paid with, as printed, e.g. "2,024 Amazon Visa rewards points"' },
      refund: {
        type: 'object',
        description: 'Only when the document shows a return or refund. Do not invent one.',
        properties: {
          total: { type: 'number', description: 'the refund total as printed, dollars, positive' },
          items: { type: 'array', description: 'the returned items. They also stay listed in `items`, because they were part of the order.', items: { type: 'object', properties: { item: { type: 'string' }, price: { type: 'number', description: 'dollars as printed' } }, required: ['item', 'price'] } },
        },
      },
      payment_method: { type: 'string', description: 'cash, card brand, wallet, as printed' },
      card_last4: { type: 'string' },
      currency: { type: 'string' },
      items: {
        type: 'array',
        description: 'every item on the order, including any that were returned. One entry per item BOUGHT. Some receipts print each item over two rows (a description row, then a row with the SKU, quantity, price and amount): that is one item, not two. A row of SKU codes or a wrapped description is never an item of its own.',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' }, price: { type: 'number', description: 'line total, dollars' }, qty: { type: 'number' },
            unit_price: { type: 'number' }, code: { type: 'string', description: 'item or SKU number as printed' }, discount: { type: 'number', description: 'discount on this line, dollars, positive' },
          },
          required: ['item', 'price'],
        },
      },
      item_count: { type: 'number', description: 'the item count the receipt prints, e.g. "SOLD ITEM COUNT = 7", "ITEMS SOLD 7", "Total items: 7". Leave out if none is printed.' },
      other_text: { type: 'string', description: 'any other printed information worth keeping: member number, loyalty points, return policy dates, authorisation codes' },
      unreadable: { type: 'string', description: 'anything you could not read' },
    },
    required: ['items'],
  },
};

const IMAGE = /^image\/(jpeg|png|webp)$/;

/**
 * The second reading asks for the same fields as plain JSON text instead of a tool call. Haiku reads some layouts (Burlington's two-row items)
 * differently in the two modes, so a second look in the other mode catches what the first missed. The shape below is what the tool returns.
 */
const JSON_PROMPT = 'Read this receipt or order. Reply with ONE JSON object and nothing else, in this shape (leave out any field that is not printed): '
  + '{"kind": "store_receipt"|"order_confirmation"|"order_history", "merchant": str, "store_address": str, "store_ref": str, "order_ref": str, "date": "YYYY-MM-DD", "time": str, '
  + '"subtotal": number, "tax": number, "tip": number, "discount": number, "charges": [{"label": str, "amount": number, "rate": number, "type": "service"|"delivery"|"fee"|"surcharge"|"gratuity"|"bag"|"other"}], "total": number, "paid_other": number, "paid_other_label": str, "payment_method": str, "card_last4": str, "currency": str, '
  + '"item_count": number, "refund": {"total": number, "items": [{"item": str, "price": number}]}, '
  + '"items": [{"item": str, "price": number, "qty": number, "unit_price": number, "code": str, "discount": number}], "other_text": str, "unreadable": str}. '
  + 'Any other charge between the items and the total that is not tax or a tip (a service charge, delivery or bag fee, surcharge) goes in charges, one entry each, with its printed percentage as rate if shown. '
  + 'Prices are dollars exactly as printed. total is what was charged to the card; if part was paid with points, a gift card or store credit, that part is paid_other. '
  + 'One entry in items per item bought, including any that were returned, with no tax or total lines. Many receipts print each item over two rows: a description row, then the row directly BELOW it with the SKU, quantity, price and amount. '
  + 'That is one item, and its price belongs to the description above its row, never the one below. item_count is the count the receipt prints (for example "SOLD ITEM COUNT = 7"). '
  + 'An earlier reading of this file did not add up to the printed subtotal, total or item count, so read the prices again row by row. Report only what is printed.';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const denied = await requireUser(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  // the app asks which readers it may offer
  if (body.action === 'models') return json(readerChoices());
  const choice: string | undefined = body.model === undefined || body.model === null || body.model === '' ? undefined : body.model;
  if (choice !== undefined && !isReaderAllowed(choice)) return json({ error: 'That reader is not on the allowed list. Add it to OPENROUTER_MODEL_CHOICES first.' }, 400);
  // `file_base64` is current; `image_base64` is what older app builds send
  const data: unknown = body.file_base64 ?? body.image_base64;
  const type: string = body.media_type ?? '';
  const isPdf = type === 'application/pdf';
  if (typeof data !== 'string' || data.length > 14_000_000 || !(IMAGE.test(type) || isPdf)) return json({ error: 'send a jpeg, png, webp or pdf under 10 MB' }, 400);
  const file = isPdf
    ? { type: 'document' as const, filename: typeof body.filename === 'string' ? body.filename.slice(0, 120) : 'receipt.pdf', source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: type, data } };
  // second look, asked for by the app when the first reading did not add up to the printed subtotal, total or item count: plain JSON, no tool call
  // a reader chosen by the person is also read in this mode, which is the one measured for every reader offered
  if (body.second_opinion === true || choice) {
    const r2 = await callModel({ max_tokens: 3000, messages: [{ role: 'user', content: [file, { type: 'text', text: JSON_PROMPT }] }] }, 'verify', choice);
    if (!r2.ok) return r2;
    const out2 = await r2.json();
    const text = (out2.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text?: string }) => b.text ?? '').join('');
    const parsed = firstJsonObject(text);
    if (!parsed || !Array.isArray(parsed.items)) return json({ error: 'The reader could not produce a complete answer for this file. Try a clearer photo or a smaller PDF.' }, 422);
    return json({ ...parsed, read_by: r2.headers.get('x-model') ?? undefined });
  }
  const r = await callModel({
    max_tokens: 3000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'record_receipt' },
    messages: [{ role: 'user', content: [
      file,
      { type: 'text', text: 'Read this receipt or order. Use record_receipt. One entry per item bought (an item printed over two rows is still one item), prices exactly as printed, and the printed item count if there is one, no tax or total lines in items. Capture every other field that is printed, even ones that look unimportant. Leave out anything that is not printed. Any other charge between the items and the total that is not tax or a tip (a service charge, delivery or bag fee, surcharge) goes in charges, one entry each. Many receipts print each item over two rows: a description row, then the row directly BELOW it with the SKU, quantity, price and amount. A price belongs to the description above its row, never the one below, so do not shift prices against descriptions. Before you answer, check that your item amounts add up to the printed subtotal and that the number of items matches the printed item count; if they do not, read the amounts again.' },
    ] }],
  }, 'vision');
  if (!r.ok) return r;
  const out = await r.json();
  const use = out.content?.find((b: { type: string }) => b.type === 'tool_use');
  if (!use || use.input?.__invalid_arguments) return json({ error: 'The reader could not produce a complete answer for this file. Try a clearer photo or a smaller PDF.' }, 422);
  return json({ ...use.input, read_by: r.headers.get('x-model') ?? undefined });
});
