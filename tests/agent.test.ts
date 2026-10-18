import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent, runTool } from '../src/core/agent';
import type { Post } from '../src/core/agent';
import { runQuery } from '../src/core/queries';
import ledger from '../src/data/seed/ledger.sample.json';

const ctx = { txns: (ledger as any).txns, accounts: (ledger as any).accounts };
const env = { today: '2026-10-16', dataFrom: '2026-06-01', dataTo: '2026-09-26', scope: 'all' as const };

test('query tool returns the same total as the engine', () => {
  const o = runTool('query', { metric: 'spend' }, ctx, env);
  assert.equal(JSON.parse(o.content).total, runQuery({ metric: 'spend' }, ctx).total);
});

test('tools reject malformed input instead of throwing', () => {
  assert.equal(runTool('query', { metric: 'drop table' }, ctx, env).error, true);
  assert.equal(runTool('query', { metric: 'spend', filter: { categories: ['nope'] } }, ctx, env).error, true);
  assert.equal(runTool('summary', { from: 'x', to: 'y' }, ctx, env).error, true);
  assert.equal(runTool('shell', { cmd: 'rm -rf /' }, ctx, env).error, true);
});

test('scope is forced by the app, not the model', () => {
  const biz = JSON.parse(runTool('query', { metric: 'spend', filter: { scope: 'all' } }, ctx, { ...env, scope: 'business' }).content).total;
  assert.equal(biz, runQuery({ metric: 'spend', filter: { scope: 'business' } }, ctx).total);
});

test('loop executes tool calls then returns text and report', async () => {
  let n = 0;
  const post: Post = async ({ messages }) => {
    n++;
    if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'query', input: { metric: 'spend', groupBy: 'category', limit: 3 } }] };
    if (n === 2) {
      const last = messages[messages.length - 1].content as any[];
      assert.equal(last[0].type, 'tool_result');
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'make_report', input: { spec: { title: 'T', period: { from: '2026-06-01', to: '2026-09-26', label: 'x' }, blocks: [{ type: 'text', text: 'hi' }] } } }] };
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
  };
  const r = await runAgent('top categories', ctx, env, post);
  assert.equal(r.text, 'Done.');
  assert.equal(r.report?.title, 'T');
});
