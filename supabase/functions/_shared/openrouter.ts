// Talks to OpenRouter (https://openrouter.ai/api/v1/chat/completions) while keeping the app's wire format unchanged.
//
// The device (src/core/agent.ts) speaks "Anthropic-shaped" messages: text / tool_use / tool_result blocks.
// OpenRouter speaks the OpenAI chat format. This file converts both ways, so the app and the tools do not change.
//
// Pure TypeScript with no Deno or Node APIs, so it is unit tested under Node (tests/openrouter.test.ts).

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; filename?: string };
export type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
export interface ToolDef { name: string; description?: string; input_schema: unknown }
export interface ModelRequest {
  system?: string;
  messages: Msg[];
  tools?: ToolDef[];
  tool_choice?: { type: 'tool'; name: string } | { type: 'auto' };
  max_tokens?: number;
}
export type PdfEngine = 'native' | 'mistral-ocr' | 'cloudflare-ai';
export interface ModelResponse { content: Block[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other' }

type OAIContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'file'; file: { filename: string; file_data: string } })[];
type OAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: OAIContent }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Anthropic-shaped request -> OpenAI chat messages. */
export function toChatMessages(system: string | undefined, messages: Msg[]): OAIMessage[] {
  const out: OAIMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content } as OAIMessage); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
      const calls = m.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // user turn: tool results become separate `tool` messages; text and images stay in one user message
    const parts: Exclude<OAIContent, string> = [];
    for (const b of m.content) {
      if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${b.content}` : b.content });
      else if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
      else if (b.type === 'document') parts.push({ type: 'file', file: { filename: b.filename ?? 'document.pdf', file_data: `data:${b.source.media_type};base64,${b.source.data}` } });
    }
    if (parts.length) out.push({ role: 'user', content: parts });
  }
  return out;
}

export function buildBody(req: ModelRequest, model: string, opts: { dataCollection?: 'allow' | 'deny'; pdfEngine?: PdfEngine } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,                                   // one fixed model: no auto-routing, no random fallback
    messages: toChatMessages(req.system, req.messages),
    max_tokens: req.max_tokens ?? 1500,
    provider: { data_collection: opts.dataCollection ?? 'deny' },
  };
  // PDFs: OpenRouter's file-parser plugin. Left out unless an engine is chosen, so the default routing applies.
  const hasPdf = req.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'document'));
  if (hasPdf && opts.pdfEngine) body.plugins = [{ id: 'file-parser', pdf: { engine: opts.pdfEngine } }];
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (req.tool_choice?.type === 'tool') body.tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
    else if (req.tool_choice?.type === 'auto') body.tool_choice = 'auto';
  }
  return body;
}

/** OpenAI chat completion -> Anthropic-shaped response. */
export function fromChatResponse(data: any): ModelResponse {
  const choice = data?.choices?.[0];
  const msg = choice?.message;
  if (!msg) throw new Error(data?.error?.message ?? 'The model returned no answer');
  const content: Block[] = [];
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: any) => p?.text ?? '').join('') : '';
  if (text.trim()) content.push({ type: 'text', text });
  for (const c of msg.tool_calls ?? []) {
    let input: unknown = {};
    try { input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = { __invalid_arguments: String(c.function?.arguments ?? '').slice(0, 200) }; }
    content.push({ type: 'tool_use', id: String(c.id), name: String(c.function?.name ?? ''), input });
  }
  const fr = choice.finish_reason;
  const stop_reason = content.some((b) => b.type === 'tool_use') ? 'tool_use' : fr === 'length' ? 'max_tokens' : fr === 'stop' || fr == null ? 'end_turn' : 'other';
  return { content, stop_reason };
}

export interface CallConfig { apiKey: string; model: string; dataCollection?: 'allow' | 'deny'; pdfEngine?: PdfEngine; title?: string; fetchImpl?: typeof fetch }

/** One model turn. Throws an Error whose message is safe to show the user. */
export async function callOpenRouter(req: ModelRequest, cfg: CallConfig): Promise<ModelResponse> {
  const f = cfg.fetchImpl ?? fetch;
  const r = await f('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': cfg.title ?? 'Finora' },
    body: JSON.stringify(buildBody(req, cfg.model, { dataCollection: cfg.dataCollection, pdfEngine: cfg.pdfEngine })),
  });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new HttpError(502, 'OpenRouter returned something that is not JSON'); }
  if (!r.ok || data?.error) {
    const status = r.ok ? 502 : r.status;
    const msg = data?.error?.message ?? `OpenRouter error ${r.status}`;
    throw new HttpError(status, status === 401 ? 'OpenRouter rejected the API key' : status === 402 ? 'OpenRouter account is out of credit' : status === 404 && /provider|data policy/i.test(msg) ? `No provider matches the data policy for this model (${msg}). Set OPENROUTER_DATA_COLLECTION=allow to relax it.` : msg);
  }
  return fromChatResponse(data);
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
