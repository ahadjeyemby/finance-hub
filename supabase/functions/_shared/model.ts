// The single place the edge functions call a model. The model is chosen by secret. A request may name a different one only if it is on the
// allowlist below, so a client can never make the backend call an arbitrary (and possibly expensive) model.
import { callOpenRouter, HttpError, type ModelRequest, type PdfEngine } from './openrouter.ts';
import { cors, json } from './auth.ts';
import { DEFAULT_MODEL, isReaderAllowed as allowed, readerChoices as choices } from './readers.ts';

export { DEFAULT_MODEL };

/** The readers a request may choose (see readers.ts), from this project's secrets. */
export const readerChoices = () => choices((k) => Deno.env.get(k));
export const isReaderAllowed = (m: unknown): m is string => allowed((k) => Deno.env.get(k), m);

/** OPENROUTER_PDF_ENGINE (optional): native | mistral-ocr | cloudflare-ai. Unset = OpenRouter's default for the model.
 * `purpose: 'vision'` lets receipts and statements use a different model if OPENROUTER_VISION_MODEL is set.
 * `purpose: 'verify'` is the second reading of a statement that failed its balance check: it uses OPENROUTER_VERIFY_MODEL
 * when set, so the second read does not repeat the first model's misreads, and otherwise the vision model. */
export async function callModel(req: ModelRequest, purpose: 'chat' | 'vision' | 'verify' = 'chat', choice?: string): Promise<Response> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: 'OPENROUTER_API_KEY is not set' }, 500);
  const picked = (purpose === 'verify' && Deno.env.get('OPENROUTER_VERIFY_MODEL')) || (purpose !== 'chat' && Deno.env.get('OPENROUTER_VISION_MODEL'));
  // a model named by the request is used only if it is on the allowlist; the callers check this first and answer 400 otherwise
  const model = (choice && isReaderAllowed(choice) ? choice : '') || picked || Deno.env.get('OPENROUTER_MODEL') || DEFAULT_MODEL;
  const dataCollection = Deno.env.get('OPENROUTER_DATA_COLLECTION') === 'allow' ? 'allow' : 'deny';
  const engine = Deno.env.get('OPENROUTER_PDF_ENGINE');
  const pdfEngine = engine === 'native' || engine === 'mistral-ocr' || engine === 'cloudflare-ai' ? (engine as PdfEngine) : undefined;
  try {
    const out = await callOpenRouter(req, { apiKey, model, dataCollection, pdfEngine });
    return new Response(JSON.stringify(out), { status: 200, headers: { ...cors, 'content-type': 'application/json', 'x-model': model } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    return json({ error: e instanceof Error ? e.message : 'model call failed' }, status);
  }
}
