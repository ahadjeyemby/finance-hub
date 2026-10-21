// Row level security for workspaces, tested on a real Postgres (PGlite) with the project's own migrations. Every test logs in as several people
// and checks what each can read and write: the point is what must NOT be possible as much as what is.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freshDb } from './support/pg';
import type { Db } from './support/pg';

interface World { d: Db; adm: string; wife: string; partner: string; stranger: string; adm2: string; w2: string }

/** admin has a wife and a partner as members; a stranger is alone; a second admin has their own member. */
async function world(): Promise<World> {
  const d = await freshDb();
  const [adm, wife, partner, stranger, adm2, w2] = await Promise.all(['adm', 'wife', 'partner', 'stranger', 'adm2', 'w2'].map((n) => d.addUser(`${n}@x.test`)));
  const join = async (owner: string, member: string, role = 'member', ai = false) => { const token = (await d.as<{ t: string }>(owner, 'select public.create_invite($1, $2, $3) as t', [(await d.admin<{ email: string }>('select email from auth.users where id = $1', [member]))[0].email, role, ai]))[0].t; await d.as(member, 'select public.accept_invite($1)', [token]); };
  await join(adm, wife); await join(adm, partner, 'contributor'); await join(adm2, w2);
  return { d, adm, wife, partner, stranger, adm2, w2 };
}

/** one row in every data table for a person; the same ids for everyone, as the app generates them per person */
async function seed(d: Db, who: string, tag: string) {
  await d.admin(`insert into public.accounts (id, user_id, name, type, coverage_from, coverage_to) values ('acc', $1, $2, 'checking', '2026-01-01', '2026-12-31')`, [who, `acct ${tag}`]);
  await d.admin(`insert into public.txns (id, user_id, account_id, date, merchant, cents, kind) values ('t1', $1, 'acc', '2026-03-01', $2, -500, 'spend')`, [who, `store ${tag}`]);
  await d.admin(`insert into public.txn_raw (user_id, txn_id, row) values ($1, 't1', '{}')`, [who]);
  await d.admin(`insert into public.statements (id, user_id, account_id, label) values ('s1', $1, 'acc', $2)`, [who, `stmt ${tag}`]);
  const r = (await d.admin<{ id: string }>(`insert into public.receipts (user_id, merchant) values ($1, $2) returning id`, [who, `rcpt ${tag}`]))[0].id;
  await d.admin(`insert into public.receipt_links (user_id, receipt_id, txn_id, method) values ($1, $2, 't1', 'manual')`, [who, r]);
  await d.admin(`insert into public.link_flags (user_id, kind, ref_id, reason) values ($1, 'txn', 't1', 'cash')`, [who]);
  await d.admin(`insert into public.overlays (user_id, body) values ($1, $2)`, [who, JSON.stringify({ tag })]);
  await d.admin(`insert into storage.objects (bucket_id, name) values ('receipts', $1), ('statements', $1)`, [`${who}/file-${tag}.jpg`]);
}

const TABLES: [string, string][] = [['accounts', 'name'], ['txns', 'merchant'], ['statements', 'label'], ['receipts', 'merchant']];
const COUNT_TABLES = ['accounts', 'txns', 'txn_raw', 'statements', 'receipts', 'receipt_links', 'link_flags', 'overlays'];
const counts = async (w: World, who: string | null) => Object.fromEntries(await Promise.all(COUNT_TABLES.map(async (t) => [t, Number((await w.d.as<{ n: string }>(who, `select count(*) as n from public.${t}`))[0].n)])));

test('each person sees only their own rows, the admin sees their members too, and nobody sees outside their workspace', async () => {
  const w = await world();
  for (const [who, tag] of [[w.adm, 'adm'], [w.wife, 'wife'], [w.partner, 'partner'], [w.stranger, 'stranger'], [w.adm2, 'adm2'], [w.w2, 'w2']] as const) await seed(w.d, who, tag);
  const names = async (who: string | null, table: string, col: string) => (await w.d.as<Record<string, string>>(who, `select ${col} from public.${table} order by 1`)).map((r) => r[col]);
  for (const [table, col] of TABLES) {
    assert.deepEqual(await names(w.wife, table, col), [`${col === 'name' ? 'acct' : col === 'merchant' && table === 'txns' ? 'store' : col === 'label' ? 'stmt' : 'rcpt'} wife`], `wife, ${table}`);
    assert.equal((await names(w.partner, table, col)).length, 1, `partner, ${table}`);
    assert.equal((await names(w.stranger, table, col)).length, 1, `stranger, ${table}`);
    const adminSees = await names(w.adm, table, col);
    assert.equal(adminSees.length, 3, `admin sees themselves, wife and partner in ${table}`);
    assert.ok(adminSees.every((x) => !/stranger|adm2|w2/.test(x)), `admin sees nobody outside the workspace in ${table}`);
    assert.equal((await names(w.adm2, table, col)).length, 2, `the other admin sees only their own workspace in ${table}`);
  }
  for (const t of COUNT_TABLES) {
    const c = await Promise.all([w.adm, w.wife, w.partner, w.stranger, w.adm2, w.w2, null].map((u) => counts(w, u)));
    assert.deepEqual(c.map((x) => x[t]), [3, 1, 1, 1, 2, 1, 0], `row counts in ${t} for admin, wife, partner, stranger, admin2, w2, nobody`);
  }
  // the folder of a member's files, too
  const files = async (who: string) => (await w.d.as<{ name: string }>(who, `select name from storage.objects where bucket_id = 'receipts' order by 1`)).map((r) => r.name);
  assert.deepEqual(await files(w.wife), [`${w.wife}/file-wife.jpg`]);
  assert.equal((await files(w.adm)).length, 3);
  assert.equal((await files(w.stranger)).length, 1);
  assert.equal((await files(w.adm2)).length, 2);
});

test('members can write only their own rows', async () => {
  const w = await world();
  await seed(w.d, w.adm, 'adm'); await seed(w.d, w.wife, 'wife');
  // as herself
  assert.equal(await w.d.asFails(w.wife, `insert into public.txns (id, user_id, account_id, date, merchant, cents, kind) values ('t2', $1, 'acc', '2026-03-02', 'mine', -100, 'spend')`, [w.wife]), null);
  // into the admin's data, or the partner's: refused
  assert.match(String(await w.d.asFails(w.wife, `insert into public.accounts (id, user_id, name, type, coverage_from, coverage_to) values ('x', $1, 'sneaky', 'checking', '2026-01-01', '2026-01-31')`, [w.adm])), /row-level security/);
  assert.match(String(await w.d.asFails(w.wife, `insert into public.link_flags (user_id, kind, ref_id, reason) values ($1, 'txn', 'z', 'cash')`, [w.partner])), /row-level security/);
  // the admin's rows cannot be changed or deleted: the statements simply do not match
  assert.equal((await w.d.as(w.wife, `update public.txns set category = 'hacked' where merchant = 'store adm' returning id`)).length, 0);
  assert.equal((await w.d.as(w.wife, `delete from public.txns where merchant = 'store adm' returning id`)).length, 0);
  assert.equal((await w.d.admin<{ category: string | null }>(`select category from public.txns where merchant = 'store adm'`))[0].category, null);
  // her own overlay she can write; the admin's she cannot
  assert.equal((await w.d.as(w.wife, `update public.overlays set body = '{"mine":true}' where user_id = $1 returning user_id`, [w.wife])).length, 1);
  assert.equal((await w.d.as(w.wife, `update public.overlays set body = '{"x":1}' returning user_id`)).length, 1, 'only her own row is even visible to change');
  // a member cannot hand a row to someone else, or take one
  assert.match(String(await w.d.asFails(w.wife, `update public.txns set user_id = $1 where id = 't2'`, [w.adm])), /row-level security|moved to another person/);
});

test('the admin can add to, change and delete what their members hold, but not other workspaces', async () => {
  const w = await world();
  await seed(w.d, w.wife, 'wife'); await seed(w.d, w.stranger, 'stranger');
  // add for the wife: an account and a charge entered by the admin on her behalf
  assert.equal(await w.d.asFails(w.adm, `insert into public.accounts (id, user_id, name, type, coverage_from, coverage_to) values ('cash', $1, 'Cash for wife', 'cash', '2026-01-01', '2026-12-31')`, [w.wife]), null);
  assert.equal(await w.d.asFails(w.adm, `insert into public.txns (id, user_id, account_id, date, merchant, cents, kind) values ('m1', $1, 'cash', '2026-03-05', 'Market', -2000, 'spend')`, [w.wife]), null);
  assert.deepEqual((await w.d.as<{ merchant: string }>(w.wife, `select merchant from public.txns where id = 'm1'`)).map((r) => r.merchant), ['Market'], 'she sees what the admin added for her');
  // change and delete hers
  assert.equal((await w.d.as(w.adm, `update public.txns set category = 'groceries' where user_id = $1 and id = 't1' returning id`, [w.wife])).length, 1);
  assert.equal((await w.d.as(w.adm, `delete from public.txns where user_id = $1 and id = 'm1' returning id`, [w.wife])).length, 1);
  // not a stranger's
  assert.match(String(await w.d.asFails(w.adm, `insert into public.txns (id, user_id, account_id, date, merchant, cents, kind) values ('m2', $1, 'acc', '2026-03-05', 'Nope', -1, 'spend')`, [w.stranger])), /row-level security/);
  assert.equal((await w.d.as(w.adm, `update public.txns set category = 'x' where user_id = $1 returning id`, [w.stranger])).length, 0);
  assert.equal((await w.d.as(w.adm, `delete from public.accounts where user_id = $1 returning id`, [w.stranger])).length, 0);
  // the other admin's member is out of reach as well
  await seed(w.d, w.w2, 'w2');
  assert.equal((await w.d.as(w.adm, `update public.accounts set name = 'x' where user_id = $1 returning id`, [w.w2])).length, 0);
  // files: the admin adds to a member's folder, not a stranger's
  assert.equal(await w.d.asFails(w.adm, `insert into storage.objects (bucket_id, name) values ('statements', $1)`, [`${w.wife}/added-by-admin.pdf`]), null);
  assert.match(String(await w.d.asFails(w.adm, `insert into storage.objects (bucket_id, name) values ('statements', $1)`, [`${w.stranger}/nope.pdf`])), /row-level security/);
});

test('a member decisions overlay is readable by the admin but never writable, and the admin keeps their own', async () => {
  const w = await world();
  await seed(w.d, w.wife, 'wife'); await seed(w.d, w.adm, 'adm');
  assert.equal((await w.d.as(w.adm, `select body from public.overlays where user_id = $1`, [w.wife])).length, 1, 'read');
  assert.equal((await w.d.as(w.adm, `update public.overlays set body = '{"hacked":1}' where user_id = $1 returning user_id`, [w.wife])).length, 0, 'no write');
  assert.equal((await w.d.as(w.adm, `delete from public.overlays where user_id = $1 returning user_id`, [w.wife])).length, 0, 'no delete');
  assert.match(String(await w.d.asFails(w.adm, `insert into public.overlays (user_id, body) values ($1, '{}')`, [w.partner])), /row-level security/, 'no creating one for a member');
  assert.equal((await w.d.as(w.adm, `update public.overlays set body = '{"mine":1}' where user_id = $1 returning user_id`, [w.adm])).length, 1, 'their own is theirs');
});

test('no row can be moved to another person, by anyone', async () => {
  const w = await world();
  await seed(w.d, w.wife, 'wife');
  // the admin, who can write her rows, still cannot take one for themselves or give it to the partner
  assert.match(String(await w.d.asFails(w.adm, `update public.txns set user_id = $1 where user_id = $2`, [w.adm, w.wife])), /moved to another person/);
  assert.match(String(await w.d.asFails(w.adm, `update public.txns set user_id = $1 where user_id = $2`, [w.partner, w.wife])), /moved to another person/);
  assert.equal(Number((await w.d.admin<{ n: string }>(`select count(*) as n from public.txns where user_id = $1`, [w.wife]))[0].n), 1);
});

test('pausing, ending or leaving a membership cuts the admin off on the next query, and the member keeps their data', async () => {
  const w = await world();
  await seed(w.d, w.wife, 'wife');
  assert.equal((await counts(w, w.adm)).txns, 1);
  // pause
  assert.equal((await w.d.as(w.adm, `update public.members set active = false where member = $1 returning member`, [w.wife])).length, 1);
  assert.equal((await counts(w, w.adm)).txns, 0, 'admin sees nothing while paused');
  assert.equal((await counts(w, w.wife)).txns, 1, 'she still has her data');
  assert.match(String(await w.d.asFails(w.adm, `insert into public.txns (id, user_id, account_id, date, merchant, cents, kind) values ('m9', $1, 'acc', '2026-03-05', 'x', -1, 'spend')`, [w.wife])), /row-level security/);
  assert.equal((await w.d.as(w.adm, `select name from storage.objects where bucket_id = 'receipts' and name like $1`, [`${w.wife}/%`])).length, 0, 'and cannot reach her files');
  // she cannot switch herself back on
  assert.equal((await w.d.as(w.wife, `update public.members set active = true where member = $1 returning member`, [w.wife])).length, 0);
  // resume
  await w.d.as(w.adm, `update public.members set active = true where member = $1`, [w.wife]);
  assert.equal((await counts(w, w.adm)).txns, 1);
  // she leaves
  assert.equal((await w.d.as(w.wife, `delete from public.members where member = $1 returning member`, [w.wife])).length, 1);
  assert.equal((await counts(w, w.adm)).txns, 0);
  assert.equal((await counts(w, w.wife)).txns, 1);
  // the admin ends the other one
  assert.equal((await w.d.as(w.adm, `delete from public.members where member = $1 returning member`, [w.partner])).length, 1);
});

test('membership comes only from an invite to the member own email, once, before it expires', async () => {
  const w = await world();
  const fresh = await w.d.addUser('newbie@x.test');
  const token = (await w.d.as<{ t: string }>(w.adm, `select public.create_invite('  Newbie@X.test ', 'member', true) as t`))[0].t;
  assert.ok(token.length >= 60);
  // the token is not stored, and the admin cannot read its hash either
  const stored = await w.d.admin<{ token_hash: string; email: string }>('select token_hash, email from public.invites order by created_at desc limit 1');
  assert.ok(!stored[0].token_hash.includes(token) && stored[0].token_hash.length === 64);
  assert.equal(stored[0].email, 'newbie@x.test', 'the address is stored lower case and trimmed');
  assert.match(String(await w.d.asFails(w.adm, 'select token_hash from public.invites')), /permission denied/);
  assert.equal((await w.d.as(w.adm, 'select id, email from public.invites where accepted_at is null')).length, 1, 'the admin can list pending invites');
  // someone else cannot use it, even with the token, and every refusal reads the same
  const refusals = [
    await w.d.asFails(w.stranger, 'select public.accept_invite($1)', [token]),
    await w.d.asFails(fresh, 'select public.accept_invite($1)', ['not-the-token']),
    await w.d.asFails(null, 'select public.accept_invite($1)', [token]),
    await w.d.asFails(w.adm, 'select public.accept_invite($1)', [token]),
  ];
  for (const r of refusals) assert.match(String(r), /Invalid or expired invite/);
  // the right person, once
  assert.equal(((await w.d.as<{ r: { role: string; can_read_ai: boolean } }>(fresh, 'select public.accept_invite($1) as r', [token]))[0].r).can_read_ai, true);
  assert.match(String(await w.d.asFails(fresh, 'select public.accept_invite($1)', [token])), /Invalid or expired invite/);
  // expired
  const t2 = (await w.d.as<{ t: string }>(w.adm, `select public.create_invite('late@x.test') as t`))[0].t;
  const late = await w.d.addUser('late@x.test');
  await w.d.admin(`update public.invites set expires_at = now() - interval '1 minute' where email = 'late@x.test'`);
  assert.match(String(await w.d.asFails(late, 'select public.accept_invite($1)', [t2])), /Invalid or expired invite/);
});

test('invites are checked: only admins and solo people send them, the address and role must be real, and the number waiting is capped', async () => {
  const w = await world();
  assert.match(String(await w.d.asFails(w.wife, `select public.create_invite('x@y.test')`)), /A member cannot invite others/);
  assert.match(String(await w.d.asFails(w.adm, `select public.create_invite('not-an-email')`)), /email address/);
  assert.match(String(await w.d.asFails(w.adm, `select public.create_invite('a@y.test', 'admin')`)), /role|check/i);
  assert.match(String(await w.d.asFails(null, `select public.create_invite('a@y.test')`)), /Sign in first/);
  for (let i = 0; i < 20; i++) await w.d.as(w.stranger, `select public.create_invite($1)`, [`p${i}@y.test`]);
  assert.match(String(await w.d.asFails(w.stranger, `select public.create_invite('one-more@y.test')`)), /Too many invites/);
});

test('an admin cannot claim data by inserting memberships, and cannot change whose membership it is', async () => {
  const w = await world();
  await seed(w.d, w.stranger, 'stranger');
  assert.match(String(await w.d.asFails(w.adm, `insert into public.members (workspace_owner, member) values ($1, $2)`, [w.adm, w.stranger])), /permission denied/);
  assert.match(String(await w.d.asFails(w.adm, `update public.members set member = $1 where member = $2`, [w.stranger, w.wife])), /permission denied/);
  assert.match(String(await w.d.asFails(w.adm, `update public.members set workspace_owner = $1 where member = $2`, [w.stranger, w.wife])), /permission denied/);
  assert.equal((await counts(w, w.adm)).txns, 0, 'the stranger stays invisible');
  // roles and flags are the admin to change
  assert.equal((await w.d.as(w.adm, `update public.members set role = 'contributor', can_read_ai = true where member = $1 returning member`, [w.wife])).length, 1);
  assert.equal((await w.d.as(w.wife, `update public.members set can_read_ai = true where member = $1 returning member`, [w.wife])).length, 0, 'a member cannot grant themselves anything');
});

test('who is in a workspace is private: a member sees only their own membership, an admin only theirs', async () => {
  const w = await world();
  assert.deepEqual((await w.d.as<{ member: string }>(w.wife, 'select member from public.members')).map((r) => r.member), [w.wife]);
  assert.equal((await w.d.as(w.adm, 'select member from public.members')).length, 2);
  assert.equal((await w.d.as(w.adm2, 'select member from public.members')).length, 1);
  assert.equal((await w.d.as(w.stranger, 'select member from public.members')).length, 0);
  assert.equal((await w.d.as(null, 'select member from public.members')).length, 0);
});

test('an admin cannot also be a member, a member cannot join twice, and a member cannot start a workspace', async () => {
  const w = await world();
  const t1 = (await w.d.as<{ t: string }>(w.adm2, `select public.create_invite('wife@x.test') as t`))[0].t;
  assert.match(String(await w.d.asFails(w.wife, 'select public.accept_invite($1)', [t1])), /Invalid or expired invite/, 'one workspace per person');
  const t2 = (await w.d.as<{ t: string }>(w.stranger, `select public.create_invite('adm@x.test') as t`))[0].t;
  assert.match(String(await w.d.asFails(w.adm, 'select public.accept_invite($1)', [t2])), /Invalid or expired invite/, 'an admin with members cannot become a member');
  const t3 = (await w.d.as<{ t: string }>(w.adm, `select public.create_invite('stranger@x.test') as t`))[0].t;
  await w.d.as(w.stranger, 'select public.accept_invite($1)', [t3]);   // stranger had created invites but has no members, so may join
  assert.match(String(await w.d.asFails(w.stranger, `select public.create_invite('z@y.test')`)), /A member cannot invite others/);
});

test('my_access tells the app and the readers what a person is', async () => {
  const w = await world();
  const a = async (u: string) => (await w.d.as<{ a: { role: string; owner: string | null; can_read_ai: boolean } }>(u, 'select public.my_access() as a'))[0].a;
  assert.deepEqual(await a(w.adm), { role: 'admin', owner: null, can_read_ai: true, active: true });
  assert.deepEqual(await a(w.wife), { role: 'member', owner: w.adm, can_read_ai: false, active: true });
  assert.deepEqual(await a(w.partner), { role: 'contributor', owner: w.adm, can_read_ai: false, active: true });
  assert.deepEqual(await a(w.stranger), { role: 'solo', owner: null, can_read_ai: true, active: true });
  await w.d.as(w.adm, `update public.members set can_read_ai = true, active = false where member = $1`, [w.wife]);
  assert.deepEqual(await a(w.wife), { role: 'member', owner: w.adm, can_read_ai: true, active: false }, 'a paused member is told so');
});

test('existing users are unaffected: someone with no workspace sees exactly what they saw before', async () => {
  const d = await freshDb();
  const [a, b] = await Promise.all([d.addUser('a@x.test'), d.addUser('b@x.test')]);
  await seed(d, a, 'a'); await seed(d, b, 'b');
  const w = { d } as World;
  assert.deepEqual(await counts(w, a), Object.fromEntries(COUNT_TABLES.map((t) => [t, 1])));
  assert.equal((await d.as(a, `update public.txns set category = 'x' where user_id = $1 returning id`, [b])).length, 0);
});

test('the admin sees members by email and by a label they set; only they can set it', async () => {
  const w = await world();
  const row = async (who: string, member: string) => (await w.d.as<{ email: string; label: string | null }>(who, 'select email, label from public.members where member = $1', [member]))[0];
  assert.equal((await row(w.adm, w.wife)).email, 'wife@x.test', 'the address comes from the invite');
  assert.equal((await row(w.adm, w.wife)).label, null);
  assert.equal((await w.d.as(w.adm, `update public.members set label = 'Sam' where member = $1 returning member`, [w.wife])).length, 1);
  assert.equal((await row(w.wife, w.wife)).label, 'Sam', 'the member sees how they are named');
  assert.equal((await w.d.as(w.wife, `update public.members set label = 'Boss' where member = $1 returning member`, [w.wife])).length, 0, 'a member cannot rename themselves');
  assert.equal((await w.d.as(w.adm, `update public.members set label = 'x' where member = $1 returning member`, [w.w2])).length, 0, 'not another workspace');
  assert.match(String(await w.d.asFails(w.adm, `update public.members set label = $1 where member = $2`, ['x'.repeat(61), w.wife])), /members_label_len|check/);
  assert.match(String(await w.d.asFails(w.adm, `update public.members set email = 'someone@else.test' where member = $1`, [w.wife])), /permission denied/, 'the address is not editable');
});
