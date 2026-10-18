// Thin proxy: holds the OpenRouter key, checks the caller, forwards one model turn.
// Tools run on the device against the person's own ledger (see src/core/agent.ts),
// so no financial data is stored or processed here.
import { cors, json, requireUser } from '../_shared/auth.ts';
import { callModel } from '../_shared/model.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const denied = await requireUser(req);
  if (denied) return denied;
  const { system, tools, messages } = await req.json().catch(() => ({}));
  if (typeof system !== 'string' || !Array.isArray(tools) || !Array.isArray(messages) || messages.length > 40) return json({ error: 'bad request' }, 400);
  // Only the five fixed read-only tools are allowed through.
  const allowed = new Set(['query', 'transactions', 'summary', 'forecast', 'make_report']);
  if (tools.some((t: { name?: string }) => !allowed.has(t?.name ?? ''))) return json({ error: 'unknown tool' }, 400);
  return callModel({ max_tokens: 1500, system, tools, messages });
});
