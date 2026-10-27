import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freshDb } from './support/pg';

test('dashboard widget choices: each person reads and writes only their own, and the table rejects unknown views and widgets', async () => {
  const d = await freshDb();
  const a = await d.addUser('a@x.test'), b = await d.addUser('b@x.test');
  const save = (who: string, view: string, widget: string, enabled: boolean, position: number) =>
    d.as(who, `insert into public.dashboard_widget_prefs (view, widget_id, enabled, position) values ($1, $2, $3, $4)
               on conflict (user_id, view, widget_id) do update set enabled = excluded.enabled, position = excluded.position`, [view, widget, enabled, position]);

  await save(a, 'overview', 'kpis', false, 0);
  await save(a, 'overview', 'fuel', true, 9);
  await save(b, 'overview', 'kpis', true, 0);
  // saving again updates the same row instead of adding one
  await save(a, 'overview', 'fuel', false, 9);

  const mine = await d.as<{ widget_id: string; enabled: boolean }>(a, 'select widget_id, enabled from public.dashboard_widget_prefs order by widget_id');
  assert.deepEqual(mine, [{ widget_id: 'fuel', enabled: false }, { widget_id: 'kpis', enabled: false }]);
  assert.equal((await d.as(b, 'select * from public.dashboard_widget_prefs')).length, 1);
  assert.equal((await d.as(null, 'select * from public.dashboard_widget_prefs')).length, 0, 'no login, no rows');

  // b cannot write a row for a, nor change or delete a's rows
  assert.ok(await d.asFails(b, `insert into public.dashboard_widget_prefs (user_id, view, widget_id, enabled, position) values ($1, 'overview', 'donut', true, 1)`, [a]));
  await d.as(b, `update public.dashboard_widget_prefs set enabled = true where user_id = $1`, [a]);
  await d.as(b, `delete from public.dashboard_widget_prefs where user_id = $1`, [a]);
  assert.equal((await d.admin('select * from public.dashboard_widget_prefs where user_id = $1', [a])).length, 2, "a's rows are untouched");

  // reset to default: a's rows for one view go; other views and other people stay
  await save(a, 'plan', 'pace', false, 2);
  await d.as(a, `delete from public.dashboard_widget_prefs where view = 'overview'`);
  assert.deepEqual((await d.admin<{ user_id: string; view: string }>('select user_id, view from public.dashboard_widget_prefs order by view')).map((r) => [r.user_id === a ? 'a' : 'b', r.view]), [['b', 'overview'], ['a', 'plan']]);

  assert.ok(await d.asFails(a, `insert into public.dashboard_widget_prefs (view, widget_id, enabled, position) values ('weekend', 'kpis', true, 0)`), 'unknown view');
  assert.ok(await d.asFails(a, `insert into public.dashboard_widget_prefs (view, widget_id, enabled, position) values ('overview', 'lottery', true, 0)`), 'unknown widget');
});
