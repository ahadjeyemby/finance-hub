import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freshDb } from './support/pg';

test('the project migrations apply to a real database, and a user sees only their own rows', async () => {
  const d = await freshDb();
  const a = await d.addUser('a@x.test'), b = await d.addUser('b@x.test');
  await d.admin(`insert into public.accounts (id, user_id, name, type, coverage_from, coverage_to) values ('acc', $1, 'A checking', 'checking', '2026-01-01', '2026-12-31'), ('acc', $2, 'B checking', 'checking', '2026-01-01', '2026-12-31')`, [a, b]);
  assert.deepEqual((await d.as(a, 'select name from public.accounts')).map((r) => (r as { name: string }).name), ['A checking']);
  assert.deepEqual((await d.as(b, 'select name from public.accounts')).map((r) => (r as { name: string }).name), ['B checking']);
  assert.equal((await d.as(null, 'select * from public.accounts')).length, 0, 'no login, no rows');
});
