// The single place the edge functions call a model. One fixed model, chosen by secret, never picked per request.
import { callOpenRouter, HttpError, type ModelRequest, type PdfEngine } from './openrouter.ts';
import { cors, json } from './auth.ts';

export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

/** OPENROUTER_PDF_ENGINE (optional): native | mistral-ocr | cloudflare-ai. Unset = OpenRouter's default for the model.
 * `purpose: 'vision'` lets receipts use a different model if OPENROUTER_VISION_MODEL is set. */
export async function callModel(req: ModelRequest, purpose: 'chat' | 'vision' = 'chat'): Promise<Response> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: 'OPENROUTER_API_KEY is not set' }, 500);
  const model = (purpose === 'vision' && Deno.env.get('OPENROUTER_VISION_MODEL')) || Deno.env.get('OPENROUTER_MODEL') || DEFAULT_MODEL;
  const dataCollection = Deno.env.get('OPENROUTER_DATA_COLLECTION') === 'allow' ? 'allow' : 'deny';
  const engine = Deno.env.get('OPENROUTER_PDF_ENGINE');
  const pdfEngine = engine === 'native' || engine === 'mistral-ocr' || engine === 'cloudflare-ai' ? (engine as PdfEngine) : undefined;
  try {
    const out = await callOpenRouter(req, { apiKey, model, dataCollection, pdfEngine });
    return new Response(JSON.stringify(out), { status: 200, headers: { ...cors, 'content-type': 'application/json' } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    return json({ error: e instanceof Error ? e.message : 'model call failed' }, status);
  }
}
