// A Contributor (migration 0010), tested on a real Postgres (PGlite) with the project's own migrations. The owner's books hold pay, a move to
// savings, card payments, rewards, balances and income settings next to ordinary spending; a Contributor must get the spending and nothing
// else, by any route, and must never change what the owner holds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { freshDb } from './support/pg';
import type { Db } from './support/pg';

interface World { d: Db; own: string; helper: string; wife: string; stranger: string; adm2: string; helper2: string }

async function world(): Promise<World> {
  const d = await freshDb();
  const [own, helper, wife, stranger, adm2, helper2] = await Promise.all(['own', 'helper', 'wife', 'stranger', 'adm2', 'helper2'].map((n) => d.addUser(`${n}@x.test`)));
  const join = async (owner: string, member: string, role: string) => {
    const email = (await d.admin<{ email: string }>('select email from auth.users where id = $1', [member]))[0].email;
    const token = (await d.as<{ t: string }>(owner, 'select public.create_invite($1, $2, false) as t', [email, role]))[0].t;
    await d.as(member, 'select public.accept_invite($1)', [token]);
  };
  await join(own, helper, 'contributor'); await join(own, wife, 'member'); await join(adm2, helper2, 'contributor');
  await seed(d, own);
  return { d, own, helper, wife, stranger, adm2, helper2 };
}

const txn = (d: Db, who: string, id: string, account: string, merchant: string, cents: number, kind: string, extra: Record<string, unknown> = {}) =>
  d.admin(`insert into public.txns (id, user_id, account_id, date, description, merchant, cents, kind, subtype, hints) values ($1, $2, $3, '2026-09-05', $4, $4, $5, $6, $7, $8)`,
    [id, who, account, merchant, cents, kind, extra.subtype ?? null, extra.hints ?? []]);

/** The owner's books: a checking account with pay and a move to savings, a savings account, a credit card with ordinary spending. */
async function seed(d: Db, own: string) {
  for (const [id, name, type] of [['chk', 'Everyday Checking', 'checking'], ['sav', 'Rainy Day Savings', 'checking'], ['card', 'Blue Card', 'credit']]) {
    await d.admin(`insert into public.accounts (id, user_id, name, institution, type, last4, coverage_from, coverage_to, income_complete) values ($1, $2, $3, 'Bank', $4, '1111', '2026-09-01', '2026-09-30', false)`, [id, own, name, type]);
  }
  await txn(d, own, 'spend', 'card', 'Grocer', -5000, 'spend', { hints: ['needs_items', 'confirm_income'] });
  await txn(d, own, 'refund', 'card', 'Shoe Shop', 2000, 'refund');
  await txn(d, own, 'fee', 'card', 'Late Fee', -3900, 'fee');
  await txn(d, own, 'debit', 'chk', 'Fuel Stop', -4000, 'spend');
  await txn(d, own, 'pay', 'chk', 'ACME PAYROLL', 500000, 'income', { subtype: 'salary', hints: ['confirm_income'] });
  await txn(d, own, 'tosav', 'chk', 'TRANSFER TO SAVINGS', -80000, 'transfer', { subtype: 'internal' });
  await txn(d, own, 'insav', 'sav', 'TRANSFER FROM CHECKING', 80000, 'transfer', { subtype: 'internal' });
  await txn(d, own, 'cardpay', 'card', 'PAYMENT THANK YOU', 120000, 'transfer', { subtype: 'card_payment' });
  await txn(d, own, 'cashback', 'card', 'CASH BACK', 1500, 'rewards', { subtype: 'cash_back' });
  await txn(d, own, 'reimb', 'chk', 'VENMO DEPOSIT', 2500, 'income', { subtype: 'unconfirmed' });     // the owner turned this into a refund
  await txn(d, own, 'bonus', 'card', 'Mystery Credit', -100, 'spend');                                 // the owner turned this into income
  await d.admin(`insert into public.statements (id, user_id, account_id, label, period_from, period_to, opening_balance_cents, closing_balance_cents, sha256) values
    ('card:2026-09-01:2026-09-30', $1, 'card', 'Blue Card September', '2026-09-01', '2026-09-30', 0, 77700, 'cardsha'),
    ('chk:2026-09-01:2026-09-30', $1, 'chk', 'Checking September', '2026-09-01', '2026-09-30', 1000000, 1420000, 'chksha')`, [own]);
  await d.admin(`insert into public.txn_raw (user_id, txn_id, row) values ($1, 'pay', '{"description":"ACME PAYROLL"}')`, [own]);
  const rcpt = async (merchant: string) => (await d.admin<{ id: string }>(`insert into public.receipts (user_id, merchant, sha256) values ($1, $2, $3) returning id`, [own, merchant, `sha-${merchant}`]))[0].id;
  const grocerReceipt = await rcpt('Grocer'); const payReceipt = await rcpt('ACME PAYROLL'); await rcpt('Loose Receipt');
  await d.admin(`insert into public.receipt_links (user_id, receipt_id, txn_id, method) values ($1, $2, 'spend', 'manual'), ($1, $3, 'pay', 'manual')`, [own, grocerReceipt, payReceipt]);
  await d.admin(`insert into public.link_flags (user_id, kind, ref_id, reason) values ($1, 'txn', 'tosav', 'no_receipt'), ($1, 'txn', 'fee', 'no_receipt')`, [own]);
  const overlay = {
    manual: [
      { id: 'c1', accountId: 'cash', date: '2026-09-07', description: 'Farmers market', merchant: 'Farmers market', cents: -1200, kind: 'spend', source: 'typed', manual: true },
      { id: 'c2', accountId: 'cash', date: '2026-09-08', description: 'Side job cash', merchant: 'Side job cash', cents: 30000, kind: 'income', source: 'typed', manual: true },
    ],
    patches: { reimb: { kind: 'refund', category: 'other' }, bonus: { kind: 'income' }, debit: { category: 'fuel', note: 'road trip' } },
    merchantRules: { Grocer: { category: 'groceries' }, 'ACME PAYROLL': { category: 'salary-rule' } },
    answered: { q1: 'income' },
    savedReports: [{ id: 'r1', createdAt: '2026-09-30', prompt: 'how much did I earn', spec: {} }],
    income: { sources: [{ id: 's1', name: 'ACME', type: 'salary', words: ['acme'] }], records: [{ id: 'p1', grossCents: 700000 }], assign: { pay: 's1' } },
    recurring: { edits: { 'ACME PAYROLL': 'confirmed' }, manual: [] },
    categories: { custom: [{ id: 'pets', label: 'Pets', group: 'need' }], edits: {}, merged: {} },
    tags: { defs: [{ id: 'trip', label: 'Trip', keywords: [] }], edits: { 't:spend': { add: ['trip'] }, 't:pay': { add: ['trip'] }, 'i:debit:-4000:fuel:0': { remove: ['trip'] }, 'i:pay:500000:pay:0': { add: ['trip'] } } },
  };
  await d.admin(`insert into public.overlays (user_id, body) values ($1, $2)`, [own, JSON.stringify(overlay)]);
  await d.admin(`insert into storage.objects (bucket_id, name) values ('receipts', $1), ('statements', $2)`, [`${own}/grocer.jpg`, `${own}/checking.pdf`]);
}

const spending = async (w: World, who = w.helper) => (await w.d.as<{ s: Record<string, any> }>(who, 'select public.contributor_spending() as s'))[0].s;

test('a contributor reads exactly the owner\'s spending, with the owner\'s decisions applied, and nothing about pay, savings or balances', async () => {
  const w = await world();
  const s = await spending(w);
  assert.equal(s.owner, w.own);
  assert.deepEqual(s.txns.map((t: any) => t.id).sort(), ['c1', 'debit', 'fee', 'refund', 'reimb', 'spend']);
  const byId = Object.fromEntries(s.txns.map((t: any) => [t.id, t]));
  assert.equal(byId.spend.category, 'groceries', 'the owner\'s merchant rule is applied');
  assert.deepEqual(byId.spend.hints, ['needs_items'], 'hints about income never leave');
  assert.equal(byId.reimb.kind, 'refund', 'a deposit the owner turned into a refund shows as a refund');
  assert.equal(byId.debit.note, 'road trip');
  assert.equal(byId.c1.manual, true, 'cash spending shows; cash income does not');
  for (const t of s.txns) { assert.equal(t.subtype, null); assert.equal(t.pair_id, null); }
  assert.deepEqual(s.accounts.map((a: any) => a.id).sort(), ['card', 'chk'], 'the savings account holds no spending, so it is not there');
  assert.ok(s.accounts.every((a: any) => !('income_complete' in a)));
  assert.deepEqual(s.statements, [{ id: 'card:2026-09-01:2026-09-30', account_id: 'card', period_from: '2026-09-01', period_to: '2026-09-30' }]);
  assert.deepEqual(s.receipts.map((r: any) => r.merchant).sort(), ['Grocer', 'Loose Receipt']);
  assert.equal(s.links.length, 1);
  assert.deepEqual(s.flags.map((f: any) => f.ref_id), ['fee']);
  assert.deepEqual(Object.keys(s.tags.edits).sort(), ['i:debit:-4000:fuel:0', 't:spend']);
  assert.deepEqual(s.categories.custom.map((c: any) => c.id), ['pets']);
  assert.deepEqual(Object.keys(s).sort(), ['accounts', 'categories', 'flags', 'links', 'owner', 'receipts', 'statements', 'tags', 'txns']);
  // the whole answer, as text: no trace of pay, savings, income settings, balances or the owner's other decisions
  const text = JSON.stringify(s);
  for (const word of [/payroll/i, /acme/i, /saving/i, /income/i, /salary/i, /balance/i, /cash.?back/i, /mystery/i, /side job/i, /earn/i, /answered/i, /patches/i, /merchantRules/i]) {
    assert.doesNotMatch(text, word);
  }
});

test('nobody else can read through the contributor functions, and a contributor gains no direct access to the owner\'s tables', async () => {
  const w = await world();
  for (const who of [w.own, w.wife, w.stranger, w.adm2, null]) assert.match(String(await w.d.asFails(who, 'select public.contributor_spending()')), /Only a contributor/);
  assert.deepEqual((await spending(w, w.helper2)).txns, [], 'another workspace\'s contributor sees only their own owner\'s (empty) books');
  for (const t of ['accounts', 'txns', 'txn_raw', 'statements', 'receipts', 'receipt_links', 'link_flags', 'overlays']) {
    assert.equal(Number((await w.d.as<{ n: string }>(w.helper, `select count(*) as n from public.${t}`))[0].n), 0, `contributor reads nothing directly from ${t}`);
  }
  for (const fn of ['owner_spending($1)', 'contributor_sees($1, \'txn\', \'pay\')']) {
    assert.match(String(await w.d.asFails(w.helper, `select * from public.${fn}`, [w.own])), /permission denied/);
  }
  const files = async (who: string, bucket: string) => (await w.d.as<{ name: string }>(who, `select name from storage.objects where bucket_id = $1`, [bucket])).map((r) => r.name);
  assert.deepEqual(await files(w.helper, 'receipts'), [`${w.own}/grocer.jpg`], 'receipt photos open');
  assert.deepEqual(await files(w.helper, 'statements'), [], 'statement files never open');
  assert.deepEqual(await files(w.helper2, 'receipts'), []);
});

test('pausing or ending the membership cuts the contributor off at once', async () => {
  const w = await world();
  await w.d.as(w.own, 'update public.members set active = false where member = $1', [w.helper]);
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_spending()')), /Only a contributor/);
  assert.equal((await w.d.as(w.helper, `select name from storage.objects where bucket_id = 'receipts'`)).length, 0);
  await w.d.as(w.own, 'update public.members set active = true where member = $1', [w.helper]);
  assert.equal((await spending(w)).txns.length, 6);
  await w.d.as(w.own, 'delete from public.members where member = $1', [w.helper]);
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_spending()')), /Only a contributor/);
});

test('a contributor\'s changes go to their own rows, only for spending and only the allowed fields; the owner reads them', async () => {
  const w = await world();
  const edit = (key: string, patch: unknown, who = w.helper, owner = w.own) => w.d.asFails(who, 'insert into public.contributor_edits (owner, key, patch) values ($1, $2, $3)', [owner, key, JSON.stringify(patch)]);
  assert.equal(await edit('t:spend', { category: 'household', note: 'paper towels too' }), null);
  assert.equal(await edit('m:Grocer', { category: 'groceries' }), null);
  assert.equal(await edit('g:t:debit', { add: ['trip'] }), null);
  assert.equal(await edit('g:i:debit:-4000:fuel:0', { remove: ['trip'] }), null);
  assert.match(String(await edit('t:pay', { category: 'x' })), /nothing to change/, 'pay is not theirs to see or change');
  assert.match(String(await edit('t:tosav', { note: 'x' })), /nothing to change/);
  assert.match(String(await edit('t:bonus', { note: 'x' })), /nothing to change/, 'a charge the owner marked as income is hidden too');
  assert.match(String(await edit('m:ACME PAYROLL', { category: 'x' })), /nothing to change/);
  assert.match(String(await edit('g:t:pay', { add: ['trip'] })), /nothing to change/);
  assert.match(String(await edit('t:spend', { kind: 'income' })), /cannot change that/);
  assert.match(String(await edit('t:spend', { cents: 1 })), /cannot change that/);
  assert.match(String(await edit('x:spend', { category: 'x' })), /Unknown kind/);
  assert.match(String(await edit('t:spend', { category: 'x' }, w.helper2, w.own)), /Only a contributor/, 'another workspace\'s contributor cannot write here');
  assert.match(String(await edit('t:spend', { category: 'x' }, w.wife, w.own)), /Only a contributor/, 'a member cannot either');
  // updating works the same way, and cannot move the row to another owner
  assert.equal((await w.d.as(w.helper, `update public.contributor_edits set patch = '{"category":"groceries"}' where key = 't:spend' returning key`)).length, 1);
  assert.match(String(await w.d.asFails(w.helper, `update public.contributor_edits set owner = $1 where key = 't:spend'`, [w.adm2])), /Only a contributor/);
  assert.match(String(await w.d.asFails(w.helper, `update public.contributor_edits set patch = '{"kind":"income"}' where key = 't:spend'`)), /cannot change that/);
  // who reads them
  assert.equal((await w.d.as(w.own, 'select key from public.contributor_edits')).length, 4, 'the owner reads every edit');
  assert.equal((await w.d.as(w.wife, 'select key from public.contributor_edits')).length, 0);
  assert.equal((await w.d.as(w.adm2, 'select key from public.contributor_edits')).length, 0);
  assert.equal((await w.d.as(w.own, `update public.contributor_edits set patch = '{}' returning key`)).length, 0, 'the owner never writes them');
  assert.equal((await w.d.as(w.own, `delete from public.contributor_edits where key = 'm:Grocer' returning key`)).length, 1, 'but may remove one');
  // and the owner's own rows are untouched by all of it
  assert.equal((await w.d.admin<{ category: string | null }>(`select category from public.txns where user_id = $1 and id = 'spend'`, [w.own]))[0].category, null);
});

test('receipts, links and flags: added to the owner\'s books, only against spending, and only their own receipts can be changed', async () => {
  const w = await world();
  const save = async (row: Record<string, unknown>) => (await w.d.as<{ id: string }>(w.helper, 'select public.contributor_save_receipt($1) as id', [JSON.stringify(row)]))[0].id;
  const rid = await save({ merchant: 'Hardware', total_cents: 2599, sha256: 'new-sha', storage_path: `${w.own}/hardware.jpg`, lines: [{ item: 'nails', cents: 2599 }] });
  const stored = (await w.d.admin<{ user_id: string; uploaded_by: string; lines: unknown }>('select user_id, uploaded_by, lines from public.receipts where id = $1', [rid]))[0];
  assert.equal(stored.user_id, w.own); assert.equal(stored.uploaded_by, w.helper);
  assert.equal(await save({ merchant: 'Hardware again', sha256: 'new-sha' }), rid, 'the same file again: the stored one comes back, unchanged');
  assert.equal(await save({ merchant: 'Grocer copy', sha256: 'sha-Grocer' }), (await w.d.admin<{ id: string }>(`select id from public.receipts where sha256 = 'sha-Grocer'`))[0].id);
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_save_receipt($1)', [JSON.stringify({ merchant: 'x', storage_path: `${w.stranger}/x.jpg` })])), /workspace folder/);
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_save_receipt($1)', [JSON.stringify({ merchant: 'x', kind: 'payslip' })])), /Unknown kind/);
  assert.match(String(await w.d.asFails(w.wife, 'select public.contributor_save_receipt($1)', [JSON.stringify({ merchant: 'x' })])), /Only a contributor/);
  // corrections: their own receipt yes, the owner's no
  assert.equal(await w.d.asFails(w.helper, 'select public.contributor_update_receipt($1, $2)', [rid, JSON.stringify({ merchant: 'Hardware Store', total_cents: 2600 })]), null);
  assert.equal((await w.d.admin<{ merchant: string }>('select merchant from public.receipts where id = $1', [rid]))[0].merchant, 'Hardware Store');
  const grocer = (await w.d.admin<{ id: string }>(`select id from public.receipts where merchant = 'Grocer'`))[0].id;
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_update_receipt($1, $2)', [grocer, JSON.stringify({ merchant: 'x' })])), /only the receipts you added/);
  // links
  const link = (txnId: string, receipt = rid) => w.d.asFails(w.helper, 'select public.contributor_save_links($1)', [JSON.stringify([{ receipt_id: receipt, txn_id: txnId, method: 'manual', confirmed: true }])]);
  assert.equal(await link('debit'), null);
  assert.equal((await w.d.admin<{ user_id: string }>(`select user_id from public.receipt_links where txn_id = 'debit'`))[0].user_id, w.own);
  assert.match(String(await link('pay')), /only to spending/);
  assert.match(String(await link('tosav')), /only to spending/);
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_delete_link($1, $2)', [grocer, 'pay'])), /nothing to change/);
  assert.equal(await w.d.asFails(w.helper, 'select public.contributor_delete_link($1, $2)', [rid, 'debit']), null);
  assert.equal((await w.d.admin(`select 1 from public.receipt_links where txn_id = 'debit'`)).length, 0);
  // the receipt linked to pay is not theirs to flag; a loose receipt and a charge are
  const payReceipt = (await w.d.admin<{ id: string }>(`select id from public.receipts where merchant = 'ACME PAYROLL'`))[0].id;
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_set_flag($1, $2, $3)', ['receipt', payReceipt, 'cash'])), /nothing to change/);
  assert.equal(await w.d.asFails(w.helper, 'select public.contributor_set_flag($1, $2, $3)', ['receipt', rid, 'cash']), null);
  assert.equal(await w.d.asFails(w.helper, 'select public.contributor_set_flag($1, $2, $3, $4)', ['txn', 'debit', 'no_receipt', 'pay at pump']), null);
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_set_flag($1, $2, $3)', ['txn', 'tosav', 'other'])), /nothing to change/);
  assert.match(String(await w.d.asFails(w.helper, 'select public.contributor_clear_flag($1, $2)', ['txn', 'tosav'])), /nothing to change/);
  assert.equal(await w.d.asFails(w.helper, 'select public.contributor_clear_flag($1, $2)', ['txn', 'debit']), null);
  assert.equal((await w.d.admin(`select 1 from public.link_flags where ref_id = 'tosav'`)).length, 1, 'the owner\'s flag on the savings move is still there');
  // files
  assert.equal((await w.d.as<{ seen: boolean }>(w.helper, `select public.contributor_file_seen('receipt', 'new-sha') as seen`))[0].seen, true);
  assert.equal((await w.d.as<{ seen: boolean }>(w.helper, `select public.contributor_file_seen('statement', 'chksha') as seen`))[0].seen, true);
  assert.equal((await w.d.as<{ seen: boolean }>(w.helper, `select public.contributor_file_seen('statement', 'nope') as seen`))[0].seen, false);
  assert.equal(await w.d.asFails(w.helper, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${w.own}/new.jpg`]), null);
  assert.match(String(await w.d.asFails(w.helper, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${w.stranger}/theirs.jpg`])), /row-level security/, 'not into anyone else\'s folder');
  assert.equal(await w.d.asFails(w.helper, `insert into storage.objects (bucket_id, name) values ('statements', $1)`, [`${w.own}/card-oct.pdf`]), null);
  assert.equal((await w.d.as(w.helper, `delete from storage.objects returning name`)).length, 0, 'no file can be deleted');
});

const cardRows = (extra: Record<string, unknown>[] = []) => [
  { id: 'oct1', account_id: 'card', date: '2026-10-03', description: 'Bakery', merchant: 'Bakery', cents: -800, kind: 'spend', category: 'restaurants', source: 'Blue Card October', hints: [] },
  { id: 'oct2', account_id: 'card', date: '2026-10-09', description: 'PAYMENT THANK YOU', merchant: 'PAYMENT THANK YOU', cents: 90000, kind: 'transfer', subtype: 'card_payment', source: 'Blue Card October', hints: [] },
  { id: 'spend', account_id: 'card', date: '2026-09-05', description: 'Changed', merchant: 'Changed', cents: -1, kind: 'spend', source: 'x', hints: [] },
  ...extra,
];
const cardStatement = (own: string, extra: Record<string, unknown> = {}) => ({ id: 'card:2026-10-01:2026-10-31', account_id: 'card', label: 'Blue Card October', period_from: '2026-10-01', period_to: '2026-10-31', opening_balance_cents: 77700, closing_balance_cents: 8500, sha256: 'octsha', storage_path: `${own}/card-oct.pdf`, ...extra });
const card = { id: 'card', name: 'Blue Card', institution: 'Bank', type: 'credit', last4: '1111', coverage_from: '2026-09-01', coverage_to: '2026-10-31' };

test('a contributor adds a credit card statement to the owner\'s books without touching a row the owner holds', async () => {
  const w = await world();
  const saveAs = (who: string, account: unknown, statement: unknown, rows: unknown, raw: unknown = []) =>
    w.d.as<{ r: Record<string, unknown> }>(who, 'select public.contributor_save_statement($1, $2, $3, $4) as r', [JSON.stringify(account), JSON.stringify(statement), JSON.stringify(rows), JSON.stringify(raw)]);
  const raw = [{ txn_id: 'oct1', line_no: 1, posted_date: '2026-10-03', source_file: 'card-oct.pdf', row: { description: 'Bakery' } }, { txn_id: 'pay', line_no: 9, row: {} }];
  const r = (await saveAs(w.helper, card, cardStatement(w.own), cardRows(), raw))[0].r;
  assert.deepEqual(r, { statement: 'added', spending_added: 1, spending_already_stored: 1 });
  const rows = await w.d.admin<{ id: string; user_id: string; pair_id: string | null; subtype: string | null; merchant: string }>(`select id, user_id, pair_id, subtype, merchant from public.txns where id in ('oct1', 'oct2', 'spend') order by id`);
  assert.deepEqual(rows.map((x) => [x.id, x.user_id === w.own, x.pair_id, x.subtype, x.merchant]), [['oct1', true, null, null, 'Bakery'], ['oct2', true, null, 'card_payment', 'PAYMENT THANK YOU'], ['spend', true, null, null, 'Grocer']], 'the owner\'s row is unchanged');
  const st = (await w.d.admin<{ uploaded_by: string; closing_balance_cents: number }>(`select uploaded_by, closing_balance_cents from public.statements where id = 'card:2026-10-01:2026-10-31'`))[0];
  assert.equal(st.uploaded_by, w.helper); assert.equal(st.closing_balance_cents, 8500);
  assert.deepEqual((await w.d.admin<{ txn_id: string }>(`select txn_id from public.txn_raw where statement_id = 'card:2026-10-01:2026-10-31'`)).map((x) => x.txn_id), ['oct1'], 'a raw line only for a row of this statement');
  assert.equal((await w.d.admin<{ coverage_to: string }>(`select coverage_to::text from public.accounts where user_id = $1 and id = 'card'`, [w.own]))[0].coverage_to, '2026-10-31');
  assert.ok((await spending(w)).txns.some((t: any) => t.id === 'oct1'), 'the new spending shows to the contributor');
  assert.ok(!(await spending(w)).txns.some((t: any) => t.id === 'oct2'), 'the card payment does not');
  assert.deepEqual((await saveAs(w.helper, card, cardStatement(w.own), cardRows()))[0].r, { statement: 'already stored', spending_added: 0, spending_already_stored: 2 });
  // a new card is created as a credit account
  const newCard = { ...card, id: 'card2', name: 'Green Card', last4: '2222' };
  await saveAs(w.helper, newCard, cardStatement(w.own, { id: 'card2:2026-10-01:2026-10-31', account_id: 'card2', storage_path: null }), [{ ...cardRows()[0], id: 'g1', account_id: 'card2' }]);
  assert.equal((await w.d.admin<{ type: string }>(`select type from public.accounts where user_id = $1 and id = 'card2'`, [w.own]))[0].type, 'credit');
});

test('a contributor cannot add a checking statement, pay, or rows to another account', async () => {
  const w = await world();
  const fails = (account: unknown, statement: unknown, rows: unknown, who = w.helper) =>
    w.d.asFails(who, 'select public.contributor_save_statement($1, $2, $3)', [JSON.stringify(account), JSON.stringify(statement), JSON.stringify(rows)]);
  const st = cardStatement(w.own);
  assert.match(String(await fails({ ...card, id: 'chk', type: 'checking' }, st, [])), /Only credit card statements/);
  assert.match(String(await fails({ ...card, id: 'chk' }, st, [])), /Only credit card statements/, 'calling the checking account a card does not work');
  assert.match(String(await fails({ ...card, id: 'sav' }, st, [])), /Only credit card statements/);
  assert.match(String(await fails(card, st, cardRows([{ id: 'x', account_id: 'card', date: '2026-10-01', merchant: 'Pay', cents: 100, kind: 'income' }]))), /only charges, refunds, fees/);
  assert.match(String(await fails(card, st, [{ ...cardRows()[0], account_id: 'chk' }])), /belong to the statement's card/);
  assert.match(String(await fails(card, st, [{ ...cardRows()[0], id: '' }])), /missing its id/);
  assert.match(String(await fails(card, { ...st, storage_path: `${w.stranger}/x.pdf` }, [])), /workspace folder/);
  assert.match(String(await fails(card, st, cardRows(), w.wife)), /Only a contributor/);
  await w.d.admin(`update public.accounts set merged_into = 'card2' where user_id = $1 and id = 'card'`, [w.own]);
  assert.match(String(await fails(card, st, cardRows())), /merged into another account/);
  assert.equal((await w.d.admin(`select 1 from public.txns where id in ('oct1', 'x')`)).length, 0, 'nothing was saved by any of these');
});

test('0010 refuses to run over contributors of the old kind, and runs twice without harm', async () => {
  const w = await world();
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0010_contributor_spending.sql'), 'utf8');
  await w.d.db.exec(sql);
  assert.equal((await spending(w)).txns.length, 6, 'a second run changes nothing');
  await w.d.db.exec('drop table public.contributor_edits');
  await assert.rejects(w.d.db.exec(sql), /2 membership\(s\) have the Contributor role/);
});
