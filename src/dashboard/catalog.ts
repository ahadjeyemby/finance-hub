import type { IconName } from '@/components/icons';
import type { ViewId } from './views';

// The 22 dashboard widgets (docs/FINORA_DASHBOARD_HANDOFF.md, section 5): what each is called, its group, its chart type, its icon and its
// default size. The components and the rules that decide readiness live in registry.tsx; this file has no React in it so tests can use it.

export type WidgetId =
  | 'kpis' | 'cashflow' | 'donut' | 'trend' | 'oneTime'
  | 'cutIdeas' | 'fixedFlex' | 'subscriptions' | 'grocery' | 'bigbox' | 'fuel'
  | 'forecast' | 'forecastBuild' | 'pace' | 'billsOnce'
  | 'bizSummary' | 'bizPending' | 'bizDonut' | 'bizTools' | 'bizPL'
  | 'attention' | 'dataHealth';

export type WidgetSize = 'S' | 'M' | 'L';
/** Ready / Needs your answers / Needs more data */
export type Readiness = 'ready' | 'answers' | 'data';
export const READINESS_LABEL: Record<Readiness, string> = { ready: 'Ready', answers: 'Needs your answers', data: 'Needs more data' };

export type WidgetGroup = 'Big picture' | 'Save money' | 'Plan ahead' | 'Business' | 'Keep it accurate';
export const GROUPS: WidgetGroup[] = ['Big picture', 'Save money', 'Plan ahead', 'Business', 'Keep it accurate'];

export interface WidgetMeta { id: WidgetId; name: string; group: WidgetGroup; chartKind: string; icon: IconName; defaultSize: WidgetSize }

const m = (id: WidgetId, name: string, group: WidgetGroup, chartKind: string, icon: IconName, defaultSize: WidgetSize): WidgetMeta => ({ id, name, group, chartKind, icon, defaultSize });

/** In group order, as the Customize panel lists them. */
export const CATALOG: WidgetMeta[] = [
  m('kpis', 'Month at a glance', 'Big picture', 'Numbers', 'numbers', 'L'),
  m('cashflow', 'Money in vs out', 'Big picture', 'Waterfall', 'water', 'M'),
  m('donut', 'Where it went', 'Big picture', 'Donut', 'donut', 'S'),
  m('trend', 'Spending by month', 'Big picture', 'Stacked bars', 'explore', 'M'),
  m('oneTime', 'One-offs vs normal months', 'Big picture', 'Ring', 'ring', 'S'),
  m('cutIdeas', 'Where you could spend less', 'Save money', 'List', 'list', 'M'),
  m('fixedFlex', 'Fixed bills vs everyday', 'Save money', 'Ring', 'ring', 'S'),
  m('subscriptions', 'Repeating bills', 'Save money', 'Bars', 'recurring', 'S'),
  m('grocery', 'Cheapest store for your basket', 'Save money', 'Table', 'cart', 'S'),
  m('bigbox', 'Big-box stores', 'Save money', 'Split bar', 'split', 'S'),
  m('fuel', 'Fuel', 'Save money', 'Bars', 'fuel', 'S'),
  m('forecast', 'Next month forecast', 'Plan ahead', 'Range', 'range', 'S'),
  m('forecastBuild', 'What next month is made of', 'Plan ahead', 'Split bar', 'split', 'M'),
  m('pace', 'Month pace', 'Plan ahead', 'Line', 'line', 'M'),
  m('billsOnce', 'Bills seen once', 'Plan ahead', 'List', 'list', 'S'),
  m('bizSummary', 'Business at a glance', 'Business', 'Numbers', 'numbers', 'L'),
  m('bizPending', 'Business or personal?', 'Business', 'List', 'list', 'M'),
  m('bizDonut', 'Waiting, by merchant', 'Business', 'Donut', 'donut', 'S'),
  m('bizTools', 'Software and tools', 'Business', 'List', 'list', 'S'),
  m('bizPL', 'Business profit and loss', 'Business', 'Bars', 'explore', 'M'),
  m('attention', 'Needs your attention', 'Keep it accurate', 'List', 'alert', 'S'),
  m('dataHealth', 'Data health', 'Keep it accurate', 'Bars', 'wallet', 'S'),
];

export const WIDGET_IDS: WidgetId[] = CATALOG.map((w) => w.id);
export const META: Record<WidgetId, WidgetMeta> = Object.fromEntries(CATALOG.map((w) => [w.id, w])) as Record<WidgetId, WidgetMeta>;
export const isWidgetId = (v: unknown): v is WidgetId => typeof v === 'string' && v in META;
/** Widgets that are about money coming in: a Contributor (migration 0009) never has them, in any view or in Customize. */
export const OWNER_ONLY_WIDGETS: ReadonlySet<WidgetId> = new Set<WidgetId>(['cashflow', 'bizPL']);
/** The widgets a person can have: all of them, or a Contributor's spending ones. */
export const widgetsFor = (spendingOnly: boolean): WidgetMeta[] => (spendingOnly ? CATALOG.filter((w) => !OWNER_ONLY_WIDGETS.has(w.id)) : CATALOG);

/** Each view's default widgets, in order, with their size in that view. */
export const PRESETS: Record<ViewId, [WidgetId, WidgetSize][]> = {
  overview: [['kpis', 'L'], ['cashflow', 'M'], ['donut', 'S'], ['trend', 'M'], ['forecast', 'S'], ['oneTime', 'S'], ['attention', 'S'], ['dataHealth', 'S']],
  household: [['cutIdeas', 'M'], ['fixedFlex', 'S'], ['trend', 'M'], ['subscriptions', 'S'], ['grocery', 'S'], ['bigbox', 'S'], ['fuel', 'S']],
  business: [['bizSummary', 'L'], ['bizPending', 'M'], ['bizDonut', 'S'], ['bizTools', 'S'], ['bizPL', 'M']],
  plan: [['forecast', 'S'], ['forecastBuild', 'M'], ['pace', 'M'], ['billsOnce', 'S'], ['subscriptions', 'S'], ['oneTime', 'S'], ['fixedFlex', 'S']],
};
