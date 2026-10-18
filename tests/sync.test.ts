import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { accountToRow, chunk, makeLedgerCache, mergeOverlays, ownerTag, ownerVerdict, parseLedgerCache, parseOverlay, projectRefOf, rowToAccount, rowToTxn, txnToRow } from '../src/core/sync';
import { emptyOverlay } from '../src/core/types';
import type { Overlay } from '../src/core/types';
import ledger from '../src/data/seed/ledger.sample.json';

test('every seed transaction and account survives a database round trip unchanged', () => {
  for (const t of (ledger as any).txns) {
    const back = rowToTxn(JSON.parse(JSON.stringify(txnToRow(t))));
    assert.deepEqual(back, t, t.id);
  }
  for (const a of (ledger as any).accounts) assert.deepEqual(rowToAccount(JSON.parse(JSON.stringify(accountToRow(a)))), a);
});

test('seed ids are unique so upsert cannot overwrite rows', () => {
  const ids = (ledger as any).txns.map((t: any) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('chunk splits without losing rows', () => {
  const xs = Array.from({ length: 1234 }, (_, i) => i);
  const c = chunk(xs, 500);
  assert.deepEqual(c.map((x) => x.length), [500, 500, 234]);
  assert.deepEqual(c.flat(), xs);
});

test('merge keeps edits from both devices and remote wins on conflict', () => {
  const a: Overlay = { ...emptyOverlay(), patches: { t1: { category: 'fuel' }, t2: { business: true } }, answered: { q1: 'a' }, merchantRules: { Shell: { category: 'fuel' } } };
  const b: Overlay = { ...emptyOverlay(), patches: { t1: { category: 'auto' }, t3: { oneOff: true } }, answered: { q2: 'b' } };
  const m = mergeOverlays(a, b);
  assert.equal(m.patches.t1.category, 'auto');
  assert.equal(m.patches.t2.business, true);
  assert.equal(m.patches.t3.oneOff, true);
  assert.deepEqual(m.answered, { q1: 'a', q2: 'b' });
  assert.equal(m.merchantRules.Shell.category, 'fuel');
});

test('merge never duplicates cash entries', () => {
  const t = { id: 'cash:1', accountId: 'cash', date: '2026-10-01', description: '', merchant: 'X', cents: -100, kind: 'spend' as const, source: 'Cash entry', manual: true };
  const m = mergeOverlays({ ...emptyOverlay(), manual: [t] }, { ...emptyOverlay(), manual: [t] });
  assert.equal(m.manual.length, 1);
});

test('parseOverlay survives garbage from the network', () => {
  assert.deepEqual(parseOverlay(null), emptyOverlay());
  assert.deepEqual(parseOverlay({ manual: 'x', patches: [], answered: 5 }), emptyOverlay());
});

// ---- where the data on screen comes from ----
test('project id is read from the Supabase URL', () => {
  assert.equal(projectRefOf('https://abcd1234.supabase.co'), 'abcd1234');
  assert.equal(projectRefOf('https://abcd1234.supabase.co/'), 'abcd1234');
  assert.equal(projectRefOf(''), null); assert.equal(projectRefOf(undefined), null); assert.equal(projectRefOf('not a url'), null);
});

test('a saved copy is used only for the same project and the same person', () => {
  const led = { accounts: (ledger as any).accounts, txns: (ledger as any).txns.slice(0, 3) };
  const raw = JSON.stringify(makeLedgerCache('projA', 'user1', '2026-10-17T00:00:00Z', led));
  assert.equal(parseLedgerCache(raw, 'projA', 'user1')?.ledger.txns.length, 3);
  assert.equal(parseLedgerCache(raw, 'projB', 'user1'), null, 'another Supabase project');
  assert.equal(parseLedgerCache(raw, 'projA', 'user2'), null, 'another person');
  assert.equal(parseLedgerCache(raw, null, 'user1'), null); assert.equal(parseLedgerCache(raw, 'projA', null), null);
  assert.equal(parseLedgerCache(JSON.stringify(led), 'projA', 'user1'), null, 'a copy from before the check has no owner, so it is not trusted');
  assert.equal(parseLedgerCache(JSON.stringify({ ...JSON.parse(raw), ledger: { accounts: [], txns: [] } }), 'projA', 'user1'), null, 'an empty copy shows nothing');
  assert.equal(parseLedgerCache('{oops', 'projA', 'user1'), null); assert.equal(parseLedgerCache(null, 'projA', 'user1'), null);
});

test('device ownership: unsent edits survive only for the same owner or an unknown (older) one', () => {
  const now = ownerTag('projA', 'user1');
  assert.equal(ownerVerdict(null, now), 'unknown');
  assert.equal(ownerVerdict(now, now), 'same');
  assert.equal(ownerVerdict(ownerTag('projB', 'user1'), now), 'other');
  assert.equal(ownerVerdict(ownerTag('projA', 'user2'), now), 'other');
});

test('no app code imports a bundled ledger: Supabase is the only source of statement data', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const bad: string[] = [];
  for (const f of walk(path.join(process.cwd(), 'src'))) {
    const text = fs.readFileSync(f, 'utf8');
    // merchant-rules.json holds naming rules, not transactions; everything else under seed/ is data
    for (const m of text.matchAll(/(?:from|require\(|import\()\s*['"]([^'"]*(?:seed\/|ledger[^'"]*\.json|examples\/)[^'"]*)['"]/g)) if (!/merchant-rules(\.sample)?\.json$/.test(m[1])) bad.push(`${path.relative(process.cwd(), f)} -> ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});
