// The app's side of a Contributor (migration 0009): the spending rule it keeps for the preview matches the database exactly, a Contributor's
// decisions become rows the database accepts, the owner sees them under their own, and Ask and Reports speak only of spending.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toolsFor, runTool, system } from '../src/core/agent';
import type { AgentEnv } from '../src/core/agent';
import { diffEdits, editsFromOverlay, layerContributorEdits, newCardPairs, overlayFromEdits, spendingView } from '../src/core/contributor';
import { applyOverlay } from '../src/core/queries';
import { answer, notSpendingOnly, planReport } from '../src/core/report';
import type { ReportSpec } from '../src/core/report';
import { txnToRow } from '../src/core/sync';
import { tagEditTxnId } from '../src/core/tags';
import type { Overlay, Txn } from '../src/core/types';
import { emptyOverlay } from '../src/core/types';
import { OWNER_ONLY_WIDGETS, widgetsFor } from '../src/dashboard/catalog';
import { contributorFixture, fixture } from '../src/dev/fixture';
import { freshDb } from './support/pg';

/** The full fictional ledger, with owner decisions of every kind added on top: a deposit turned into a refund, a charge turned into income, a rule, cash. */
function ownerBooks(): { txns: Txn[]; overlay: Overlay } {
  const f = fixture('full');
  const income = f.txns.find((t) => t.kind === 'income')!;
  const spend = f.txns.filter((t) => t.kind === 'spend');
  const overlay: Overlay = {
    ...structuredClone(f.overlay),
    patches: { ...f.overlay.patches, [income.id]: { kind: 'refund', category: 'other' }, [spend[0].id]: { kind: 'income', subtype: 'other' }, [spend[1].id]: { note: 'kept', merchant: 'Renamed Shop' } },
    merchantRules: { ...f.overlay.merchantRules, [spend[2].merchant]: { category: 'household' } },
    manual: [
      { id: 'cash:1', accountId: 'cash', date: '2026-09-07', description: 'Market', merchant: 'Market', cents: -1200, kind: 'spend', source: 'Cash entry', manual: true },
      { id: 'cash:2', accountId: 'cash', date: '2026-09-08', description: 'Odd job', merchant: 'Odd job', cents: 30000, kind: 'income', source: 'Cash entry', manual: true },
    ],
  };
  return { txns: f.txns, overlay };
}

test('the spending rule the app keeps is exactly the database\'s, row for row, on the whole fictional ledger', async () => {
  const { txns, overlay } = ownerBooks();
  const d = await freshDb();
  const [own, helper] = await Promise.all([d.addUser('own@x.test'), d.addUser('helper@x.test')]);
  const token = (await d.as<{ t: string }>(own, `select public.create_invite('helper@x.test', 'contributor', false) as t`))[0].t;
  await d.as(helper, 'select public.accept_invite($1)', [token]);
  for (const a of fixture('full').accounts) {
    await d.admin(`insert into public.accounts (id, user_id, name, institution, type, last4, coverage_from, coverage_to) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [a.id, own, a.name, a.institution, a.type, a.last4, a.coverage.from, a.coverage.to]);
  }
  for (const t of txns) {
    const r = txnToRow(t);
    await d.admin(`insert into public.txns (id, user_id, account_id, date, description, merchant, cents, kind, subtype, category, subcategory, business, one_off, pair_id, source, ref, note, hints, manual, lines)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [r.id, own, r.account_id, r.date, r.description, r.merchant, r.cents, r.kind, r.subtype, r.category, r.subcategory, r.business, r.one_off, r.pair_id, r.source, r.ref, r.note, r.hints, r.manual, r.lines == null ? null : JSON.stringify(r.lines)]);
  }
  await d.admin('insert into public.overlays (user_id, body) values ($1, $2)', [own, JSON.stringify(overlay)]);
  const db = (await d.as<{ s: { txns: Record<string, unknown>[] } }>(helper, 'select public.contributor_spending() as s'))[0].s.txns;
  const app = spendingView(txns, overlay);
  const key = (t: { id?: unknown; kind?: unknown; category?: unknown; merchant?: unknown; cents?: unknown; note?: unknown }) => `${t.id}|${t.kind}|${t.category ?? ''}|${t.merchant}|${t.cents}|${t.note ?? ''}`;
  assert.ok(app.length > 50, 'a real amount of spending is compared');
  assert.deepEqual(db.map(key).sort(), app.map((t) => key(t)).sort());
  // and it is what the owner's own app counts as spending, refunds and fees
  assert.deepEqual(app.map((t) => t.id).sort(), applyOverlay(txns, overlay).filter((t) => ['spend', 'fee', 'refund'].includes(t.kind)).map((t) => t.id).sort());
});

test('the Contributor preview holds no income, rewards or transfers, and no account that only holds them', () => {
  const f = contributorFixture();
  assert.ok(f.txns.length > 0);
  assert.ok(f.txns.every((t) => ['spend', 'fee', 'refund'].includes(t.kind) && t.subtype === undefined && t.pairId === undefined));
  assert.ok(f.accounts.every((a) => a.incomeComplete === undefined));
  assert.ok(f.statements.every((s) => f.accounts.find((a) => a.id === s.accountId)?.type === 'credit'));
  assert.deepEqual(f.overlay, emptyOverlay(), 'a Contributor starts with no decisions of their own');
  assert.ok(Object.keys(f.owner.tags.edits).every((k) => f.txns.some((t) => t.id === tagEditTxnId(k))));
});

test('a Contributor\'s decisions become rows with allowed fields only, and come back the same', () => {
  const o: Overlay = {
    ...emptyOverlay(),
    patches: { a: { category: 'groceries', note: 'n', kind: 'income', merchant: 'x' }, b: { kind: 'transfer' }, c: { oneOff: true, business: false } },
    merchantRules: { Shop: { category: 'household', business: true } },
    tags: { defs: [], edits: { 't:a': { add: ['trip'] }, 'i:a:-500:milk:0': { remove: ['health'], category: 'groceries' } } },
  };
  const rows = editsFromOverlay(o);
  assert.deepEqual(rows, [
    { key: 'g:i:a:-500:milk:0', patch: { remove: ['health'], category: 'groceries' } },
    { key: 'g:t:a', patch: { add: ['trip'] } },
    { key: 'm:Shop', patch: { category: 'household', business: true } },
    { key: 't:a', patch: { category: 'groceries', note: 'n' } },
    { key: 't:c', patch: { business: false, oneOff: true } },
  ], 'kind, merchant and a patch with nothing allowed are left out');
  const back = overlayFromEdits(rows);
  assert.deepEqual(back.patches, { a: { category: 'groceries', note: 'n' }, c: { business: false, oneOff: true } });
  assert.deepEqual(back.merchantRules, { Shop: { category: 'household', business: true } });
  assert.deepEqual(Object.keys(back.tagEdits).sort(), ['i:a:-500:milk:0', 't:a']);
  const d = diffEdits(rows, [{ key: 't:a', patch: { category: 'groceries', note: 'n' } }, { key: 't:gone', patch: { note: 'x' } }, { key: 'm:Shop', patch: { category: 'other' } }]);
  assert.deepEqual(d.upsert.map((e) => e.key), ['g:i:a:-500:milk:0', 'g:t:a', 'm:Shop', 't:c']);
  assert.deepEqual(d.remove, ['t:gone']);
});

test('the owner sees Contributor changes under their own, newest Contributor first, and never saves them', () => {
  const own: Overlay = { ...emptyOverlay(), patches: { a: { category: 'fuel' } }, merchantRules: { Shop: { category: 'other' } }, tags: { defs: [], edits: { 't:a': { add: ['mine'] } } } };
  const edits = [
    { contributor: 'c1', updatedAt: '2026-10-02', key: 't:a', patch: { category: 'groceries', note: 'from c1' } },
    { contributor: 'c2', updatedAt: '2026-10-01', key: 't:b', patch: { category: 'household' } },
    { contributor: 'c1', updatedAt: '2026-10-03', key: 't:b', patch: { category: 'restaurants' } },
    { contributor: 'c2', updatedAt: '2026-10-01', key: 'm:Shop', patch: { category: 'household' } },
    { contributor: 'c2', updatedAt: '2026-10-01', key: 'm:Cafe', patch: { category: 'restaurants' } },
    { contributor: 'c2', updatedAt: '2026-10-01', key: 'g:t:b', patch: { add: ['trip'] } },
  ];
  const shown = layerContributorEdits(own, edits);
  assert.deepEqual(shown.patches.a, { category: 'fuel', note: 'from c1' }, 'the owner\'s category wins; the note is added');
  assert.deepEqual(shown.patches.b, { category: 'restaurants' }, 'the newest Contributor edit wins among Contributors');
  assert.deepEqual(shown.merchantRules, { Shop: { category: 'other' }, Cafe: { category: 'restaurants' } });
  assert.deepEqual(shown.tags?.edits, { 't:a': { add: ['mine'] }, 't:b': { add: ['trip'] } });
  assert.deepEqual(own.patches, { a: { category: 'fuel' } }, 'the owner\'s own overlay is unchanged');
  assert.equal(layerContributorEdits(own, []), own);
});

test('card payments a Contributor added are paired with the checking side; rows already paired are left alone', () => {
  const t = (id: string, cents: number, date: string, pairId?: string): Txn => ({ id, accountId: cents < 0 ? 'chk' : 'card', date, description: 'PAYMENT', merchant: 'PAYMENT', cents, kind: 'transfer', subtype: 'card_payment', source: 's', ...(pairId ? { pairId } : {}) });
  const pairs = newCardPairs([t('out1', -5000, '2026-10-01'), t('in1', 5000, '2026-10-03'), t('out2', -7000, '2026-10-05', 'in2'), t('in2', 7000, '2026-10-06', 'out2'), t('in3', 9000, '2026-10-06')]);
  assert.deepEqual(pairs.sort((a, b) => a.id.localeCompare(b.id)), [{ id: 'in1', pairId: 'out1' }, { id: 'out1', pairId: 'in1' }]);
});

test('Ask for a Contributor: spending tools and instructions, and nothing else answers', () => {
  const f = contributorFixture();
  const ctx = { txns: f.txns, accounts: f.accounts };
  const env: AgentEnv = { today: '2026-10-20', dataFrom: '2026-06-01', dataTo: '2026-10-12', scope: 'all', spendingOnly: true };
  const tools = JSON.stringify(toolsFor(env));
  const words = /income|earn|salary|deposit|saving|rewards|net\b|transfer/i;
  assert.doesNotMatch(tools, words);
  assert.doesNotMatch(system(env), words);
  assert.match(JSON.stringify(toolsFor({ ...env, spendingOnly: false })), /income/, 'the owner\'s tools are unchanged');
  assert.ok(runTool('query', { metric: 'income' }, ctx, env).error);
  assert.ok(!runTool('query', { metric: 'spend', groupBy: 'category' }, ctx, env).error);
  assert.deepEqual(Object.keys(JSON.parse(runTool('summary', { from: '2026-09-01', to: '2026-09-30' }, ctx, env).content)).sort(), ['from', 'partialAccounts', 'spent', 'to']);
  const earned: ReportSpec = { title: 'Earned vs spent', period: { from: '2026-09-01', to: '2026-09-30', label: 'September' }, blocks: [{ type: 'kpis', items: [{ label: 'Spent', query: { metric: 'spend' } }] }] };
  assert.ok(runTool('make_report', { spec: earned }, ctx, env).error, 'words about pay are refused');
  assert.ok(runTool('make_report', { spec: { ...earned, title: 'September', blocks: [{ type: 'kpis', items: [{ label: 'In', query: { metric: 'income' } }] }] } }, ctx, env).error);
  assert.ok(!runTool('make_report', { spec: { ...earned, title: 'September spending' } }, ctx, env).error);
});

test('the built-in planner makes a spending-only report for a Contributor, whatever is asked', () => {
  const f = contributorFixture();
  const ctx = { txns: f.txns, accounts: f.accounts };
  for (const q of ['Earned vs spent by month', 'what did I earn in July', 'net cash flow this summer', 'Groceries by store']) {
    const spec = planReport(q, ctx, '2026-10-20', { spendingOnly: true });
    assert.deepEqual(notSpendingOnly({ ...spec, subtitle: undefined }), [], q);
    assert.doesNotMatch(answer(q, ctx, '2026-10-20', { spendingOnly: true }).text, /earn|income|rewards/i, q);
  }
  assert.ok(planReport('what did I earn in July', ctx, '2026-10-20').blocks.some((b) => b.type === 'kpis' && b.items.some((i) => i.query.metric === 'income')), 'the owner still gets Earned');
});

test('a Contributor\'s dashboard has no widget about money coming in', () => {
  assert.deepEqual([...OWNER_ONLY_WIDGETS].sort(), ['bizPL', 'cashflow']);
  assert.ok(widgetsFor(true).every((w) => !OWNER_ONLY_WIDGETS.has(w.id)));
  assert.equal(widgetsFor(false).length, widgetsFor(true).length + OWNER_ONLY_WIDGETS.size);
});
