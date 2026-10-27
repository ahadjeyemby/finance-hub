import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CATALOG, PRESETS, WIDGET_IDS } from '../src/dashboard/catalog';
import { countOn, mergePrefs, presetRows, resolveView, toggleWidget } from '../src/dashboard/layout';
import type { PrefRow } from '../src/dashboard/layout';
import { VIEW_IDS } from '../src/dashboard/views';

const ids = (view: Parameters<typeof resolveView>[0], rows: PrefRow[] | null) => resolveView(view, rows).map((p) => `${p.id} ${p.size}`);

test('there are 22 widgets, each in exactly one group, and every preset uses only known widgets', () => {
  assert.equal(CATALOG.length, 22);
  assert.equal(new Set(WIDGET_IDS).size, 22);
  for (const v of VIEW_IDS) for (const [id] of PRESETS[v]) assert.ok(WIDGET_IDS.includes(id), `${v}: ${id}`);
});

test('a view with no saved rows shows its preset, in order and at the preset sizes', () => {
  assert.deepEqual(ids('overview', null), ['kpis L', 'cashflow M', 'donut S', 'trend M', 'forecast S', 'oneTime S', 'attention S', 'dataHealth S']);
  assert.deepEqual(ids('household', []), ['cutIdeas M', 'fixedFlex S', 'trend M', 'subscriptions S', 'grocery S', 'bigbox S', 'fuel S']);
  assert.deepEqual(ids('business', null), ['bizSummary L', 'bizPending M', 'bizDonut S', 'bizTools S', 'bizPL M']);
  assert.deepEqual(ids('plan', null), ['forecast S', 'forecastBuild M', 'pace M', 'billsOnce S', 'subscriptions S', 'oneTime S', 'fixedFlex S']);
});

test('a widget switched on outside the preset goes after the preset widgets, at its default size', () => {
  const rows = toggleWidget('business', null, 'fuel', true);
  assert.deepEqual(ids('business', rows), ['bizSummary L', 'bizPending M', 'bizDonut S', 'bizTools S', 'bizPL M', 'fuel S']);
  const two = toggleWidget('business', rows, 'kpis', true);
  assert.deepEqual(ids('business', two).slice(-2), ['fuel S', 'kpis L'], 'in the order they were switched on');
});

test('a preset widget switched off and on again goes back to its place', () => {
  const off = toggleWidget('overview', null, 'donut', false);
  assert.ok(!ids('overview', off).includes('donut S'));
  const extra = toggleWidget('overview', off, 'fuel', true);
  const back = toggleWidget('overview', extra, 'donut', true);
  assert.deepEqual(ids('overview', back), ['kpis L', 'cashflow M', 'donut S', 'trend M', 'forecast S', 'oneTime S', 'attention S', 'dataHealth S', 'fuel S']);
});

test('an extra widget stays after a preset widget that is switched back on later, even the last one', () => {
  const off = toggleWidget('overview', null, 'dataHealth', false);
  const extra = toggleWidget('overview', off, 'fuel', true);
  const back = toggleWidget('overview', extra, 'dataHealth', true);
  assert.deepEqual(ids('overview', back).slice(-2), ['dataHealth S', 'fuel S']);
});

test('switching everything off stays off: it never falls back to the preset', () => {
  let rows: PrefRow[] | null = null;
  for (const [id] of PRESETS.plan) rows = toggleWidget('plan', rows, id, false);
  assert.equal(countOn('plan', rows), 0);
  assert.equal(rows!.length, 22, 'the snapshot keeps a row for every widget, switched off ones included');
});

test('each view keeps its own set, and resetting one view leaves the others alone', () => {
  const saved: Partial<Record<string, PrefRow[]>> = {};
  saved.overview = toggleWidget('overview', null, 'kpis', false);
  saved.household = toggleWidget('household', null, 'fuel', false);
  assert.ok(!ids('overview', saved.overview!).includes('kpis L'));
  // reset = the view's rows are removed
  delete saved.overview;
  assert.deepEqual(ids('overview', saved.overview ?? null), ids('overview', null));
  assert.ok(!ids('household', saved.household!).includes('fuel S'), 'household is unchanged');
});

test("a change made on this device before the database answered keeps that view only; the database's other views still arrive", () => {
  const remote = { household: toggleWidget('household', null, 'fuel', false), business: toggleWidget('business', null, 'kpis', true) };
  const local = { overview: toggleWidget('overview', null, 'donut', false) };
  const merged = mergePrefs(remote, local, ['overview', 'business']);
  assert.deepEqual(Object.keys(merged).sort(), ['household', 'overview'], 'business was reset on this device and stays reset');
  assert.equal(merged.household, remote.household);
  assert.equal(merged.overview, local.overview);
});

test('saved rows from an older version that miss a widget follow the preset for that widget', () => {
  const rows = presetRows('overview').filter((r) => r.widget !== 'dataHealth');
  assert.ok(ids('overview', rows).includes('dataHealth S'));
  assert.deepEqual(ids('overview', [{ widget: 'kpis', enabled: false, position: 0 }]), ids('overview', null).filter((x) => x !== 'kpis L'));
});
