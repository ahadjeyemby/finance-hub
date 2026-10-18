import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../src/core/agent';
import type { Post } from '../src/core/agent';
import ledger from '../src/data/seed/ledger.sample.json';
import { buildBody, callOpenRouter, fromChatResponse, HttpError, toChatMessages } from '../supabase/functions/_shared/openrouter';

const tool = { name: 'query', description: 'run a query', input_schema: { type: 'object', properties: { metric: { type: 'string' } } } };

test('request: tools, tool_use and tool_result map to the OpenAI shape', () => {
  const msgs = toChatMessages('sys', [
    { role: 'user', content: 'how much on fuel?' },
    { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'c1', name: 'query', input: { metric: 'spend' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"total":5}' }] },
  ]);
  assert.deepEqual(msgs[0], { role: 'system', content: 'sys' });
  assert.deepEqual(msgs[2], { role: 'assistant', content: 'checking', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query', arguments: '{"metric":"spend"}' } }] });
  assert.deepEqual(msgs[3], { role: 'tool', tool_call_id: 'c1', content: '{"total":5}' });
  const body: any = buildBody({ messages: [], tools: [tool], tool_choice: { type: 'tool', name: 'query' } }, 'anthropic/claude-haiku-5.5');
  assert.equal(body.model, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(body.provider, { data_collection: 'deny' });
  assert.deepEqual(body.tools[0], { type: 'function', function: { name: 'query', description: 'run a query', parameters: tool.input_schema } });
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'query' } });
  assert.equal('models' in body, false, 'no fallback list: the model is never swapped silently');
});

test('request: tool errors are flagged and images become data URLs', () => {
  const msgs: any[] = toChatMessages(undefined, [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'bad input', is_error: true }] },
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'read it' }] },
  ]);
  assert.equal(msgs[0].content, 'Error: bad input');
  assert.deepEqual(msgs[1].content[0], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
});

test('response: text, tool calls, stop reasons, malformed arguments', () => {
  const r = fromChatResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'query', arguments: '{"metric":"spend"}' } }] } }] });
  assert.equal(r.stop_reason, 'tool_use');
  assert.deepEqual(r.content, [{ type: 'tool_use', id: 'x', name: 'query', input: { metric: 'spend' } }]);
  assert.equal(fromChatResponse({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }).stop_reason, 'end_turn');
  assert.equal(fromChatResponse({ choices: [{ finish_reason: 'length', message: { content: 'hi' } }] }).stop_reason, 'max_tokens');
  const bad: any = fromChatResponse({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'y', function: { name: 'query', arguments: '{oops' } }] } }] });
  assert.ok(bad.content[0].input.__invalid_arguments);
  assert.throws(() => fromChatResponse({ error: { message: 'boom' } }), /boom/);
});

const fakeFetch = (handler: (body: any) => { status?: number; json: unknown }) => (async (_url: string, init: any) => {
  const out = handler(JSON.parse(init.body));
  return new Response(JSON.stringify(out.json), { status: out.status ?? 200 });
}) as unknown as typeof fetch;

test('errors become readable messages', async () => {
  const cfg = (status: number, error: unknown) => ({ apiKey: 'k', model: 'm', fetchImpl: fakeFetch(() => ({ status, json: { error } })) });
  await assert.rejects(callOpenRouter({ messages: [] }, cfg(401, { message: 'x' })), (e: any) => e instanceof HttpError && /rejected the API key/.test(e.message));
  await assert.rejects(callOpenRouter({ messages: [] }, cfg(402, { message: 'x' })), /out of credit/);
  await assert.rejects(callOpenRouter({ messages: [] }, cfg(404, { message: 'No endpoints found matching your data policy' })), /OPENROUTER_DATA_COLLECTION/);
});

test('agent loop runs end to end through a fake OpenRouter', async () => {
  const seen: any[] = [];
  const fetchImpl = fakeFetch((body) => {
    seen.push(body);
    const last = body.messages[body.messages.length - 1];
    if (last.role === 'tool') return { json: { choices: [{ finish_reason: 'stop', message: { content: 'You spent that much.' } }] } };
    return { json: { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'query', arguments: JSON.stringify({ metric: 'spend' }) } }] } }] } };
  });
  const post: Post = async (body) => (await callOpenRouter(body as any, { apiKey: 'k', model: 'anthropic/claude-haiku-5.5', fetchImpl })) as any;
  const ctx = { txns: (ledger as any).txns, accounts: (ledger as any).accounts };
  const env = { today: '2026-10-16', dataFrom: '2026-06-01', dataTo: '2026-09-26', scope: 'all' as const };
  const res: any = await runAgent('how much did I spend?', ctx, env, post);
  assert.match(res.text, /spent/);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].messages.at(-1).role, 'tool');
  assert.equal(seen[1].messages.at(-2).tool_calls[0].id, 'call_1');
  assert.ok(seen.every((b) => b.model === 'anthropic/claude-haiku-5.5'));
});

test('a PDF becomes a file part with a data URL, and the file-parser plugin is added only when an engine is chosen', () => {
  const req = { messages: [{ role: 'user' as const, content: [{ type: 'document' as const, filename: 'june.pdf', source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'JVBERi0=' } }, { type: 'text' as const, text: 'read it' }] }] };
  const msgs: any[] = toChatMessages(undefined, req.messages);
  assert.deepEqual(msgs[0].content[0], { type: 'file', file: { filename: 'june.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } });
  assert.equal((buildBody(req, 'm') as any).plugins, undefined);
  assert.deepEqual((buildBody(req, 'm', { pdfEngine: 'mistral-ocr' }) as any).plugins, [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }]);
  const imgOnly = { messages: [{ role: 'user' as const, content: [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'AAAA' } }] }] };
  assert.equal((buildBody(imgOnly, 'm', { pdfEngine: 'mistral-ocr' }) as any).plugins, undefined, 'no plugin for images');
});
