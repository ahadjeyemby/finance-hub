import { META, PRESETS, WIDGET_IDS } from './catalog';
import type { WidgetId, WidgetSize } from './catalog';
import type { ViewId } from './views';

// What a view shows, from its preset and the person's saved choices. Pure: no React, no storage, so it is tested directly.
//
// Saved choices for a view are a full snapshot, one row per widget with `enabled` and `position`. No rows means "use the preset". Switching a
// widget changes only its own row; a widget switched on outside the preset is given the next position after everything already on, so it goes
// after the preset widgets, at its default size.

export interface PrefRow { widget: WidgetId; enabled: boolean; position: number }
export interface Placed { id: WidgetId; size: WidgetSize }

/** The rows that describe a view exactly as its preset shows it. */
export function presetRows(view: ViewId): PrefRow[] {
  const preset = PRESETS[view];
  const inPreset = new Map(preset.map(([id], i) => [id, i]));
  return WIDGET_IDS.map((id, i) => ({ widget: id, enabled: inPreset.has(id), position: inPreset.get(id) ?? preset.length + 100 + i }));
}

/** The person's rows, completed: a widget they have no row for (one added in a later version) follows the preset. */
function complete(view: ViewId, rows: PrefRow[]): PrefRow[] {
  const have = new Map(rows.filter((r) => META[r.widget]).map((r) => [r.widget, r]));
  return presetRows(view).map((p) => have.get(p.widget) ?? p);
}

/** The widgets on show in a view, in order, each at its size: its size in the preset, or its default size when it is not in the preset. */
export function resolveView(view: ViewId, rows: PrefRow[] | null | undefined): Placed[] {
  const sizeIn = new Map(PRESETS[view]);
  const all = rows && rows.length ? complete(view, rows) : presetRows(view);
  return all.filter((r) => r.enabled).sort((a, b) => a.position - b.position || WIDGET_IDS.indexOf(a.widget) - WIDGET_IDS.indexOf(b.widget))
    .map((r) => ({ id: r.widget, size: sizeIn.get(r.widget) ?? META[r.widget].defaultSize }));
}

/** Widgets added outside the preset are numbered from here, so they always come after the preset's own, even one switched back on later. */
export const EXTRA_FROM = 1000;

/** Switch one widget on or off. Returns the view's full new snapshot. */
export function toggleWidget(view: ViewId, rows: PrefRow[] | null | undefined, id: WidgetId, on: boolean): PrefRow[] {
  const all = rows && rows.length ? complete(view, rows) : presetRows(view);
  const inPreset = PRESETS[view].some(([w]) => w === id);
  const lastExtra = Math.max(EXTRA_FROM - 1, ...all.filter((r) => r.enabled && r.widget !== id && r.position >= EXTRA_FROM).map((r) => r.position));
  return all.map((r) => {
    if (r.widget !== id) return r;
    // a preset widget keeps its place when it comes back; anything else joins the end, after the preset widgets and earlier extras
    if (on && !r.enabled && !inPreset) return { ...r, enabled: true, position: lastExtra + 1 };
    return { ...r, enabled: on };
  });
}

/** Every view's saved snapshot; a view that is missing shows its preset. */
export type Prefs = Partial<Record<ViewId, PrefRow[]>>;

/**
 * The database's copy and this device's, put together: a view changed on this device and not yet saved keeps the device's version (or its
 * reset, when the device has none); every other view takes the database's.
 */
export function mergePrefs(remote: Prefs, local: Prefs, unsaved: Iterable<ViewId>): Prefs {
  const out: Prefs = { ...remote };
  for (const v of unsaved) { if (local[v]) out[v] = local[v]; else delete out[v]; }
  return out;
}

/** How many widgets are on in a view. */
export const countOn = (view: ViewId, rows: PrefRow[] | null | undefined) => resolveView(view, rows).length;
