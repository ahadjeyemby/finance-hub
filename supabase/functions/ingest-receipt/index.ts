// Reads a receipt (photo or PDF) and returns everything printed on it for the person to review.
// Nothing is saved here: the app analyses the result, asks about anything missing, and saves only after confirmation.
import { cors, json, requireUser } from '../_shared/auth.ts';
import { callModel } from '../_shared/model.ts';

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
      total: { type: 'number', description: 'amount charged to the card or paid, dollars' },
      payment_method: { type: 'string', description: 'cash, card brand, wallet, as printed' },
      card_last4: { type: 'string' },
      currency: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' }, price: { type: 'number', description: 'line total, dollars' }, qty: { type: 'number' },
            unit_price: { type: 'number' }, code: { type: 'string', description: 'item or SKU number as printed' }, discount: { type: 'number', description: 'discount on this line, dollars, positive' },
          },
          required: ['item', 'price'],
        },
      },
      other_text: { type: 'string', description: 'any other printed information worth keeping: member number, loyalty points, return policy dates, authorisation codes' },
      unreadable: { type: 'string', description: 'anything you could not read' },
    },
    required: ['items'],
  },
};

const IMAGE = /^image\/(jpeg|png|webp)$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const denied = await requireUser(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  // `file_base64` is current; `image_base64` is what older app builds send
  const data: unknown = body.file_base64 ?? body.image_base64;
  const type: string = body.media_type ?? '';
  const isPdf = type === 'application/pdf';
  if (typeof data !== 'string' || data.length > 14_000_000 || !(IMAGE.test(type) || isPdf)) return json({ error: 'send a jpeg, png, webp or pdf under 10 MB' }, 400);
  const file = isPdf
    ? { type: 'document' as const, filename: typeof body.filename === 'string' ? body.filename.slice(0, 120) : 'receipt.pdf', source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: type, data } };
  const r = await callModel({
    max_tokens: 3000,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'record_receipt' },
    messages: [{ role: 'user', content: [
      file,
      { type: 'text', text: 'Read this receipt or order. Use record_receipt. One entry per purchased line, prices exactly as printed, no tax or total lines in items. Capture every other field that is printed, even ones that look unimportant. Leave out anything that is not printed.' },
    ] }],
  }, 'vision');
  if (!r.ok) return r;
  const out = await r.json();
  const use = out.content?.find((b: { type: string }) => b.type === 'tool_use');
  if (!use || use.input?.__invalid_arguments) return json({ error: 'The reader could not produce a complete answer for this file. Try a clearer photo or a smaller PDF.' }, 422);
  return json(use.input);
});
