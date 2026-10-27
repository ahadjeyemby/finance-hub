import type { ComponentType } from 'react';

import type { DashboardData } from '@/core/dashboard';
import { META } from './catalog';
import type { Readiness, WidgetId, WidgetMeta, WidgetSize } from './catalog';
import type { ViewId } from './views';
import { Attention, DataHealth } from './widgets/accurate';
import { Cashflow, Donut, Kpis, OneTime, Trend } from './widgets/bigPicture';
import { BizDonut, BizPL, BizPending, BizSummary, BizTools } from './widgets/business';
import { BillsOnce, Forecast, ForecastBuild, Pace } from './widgets/planAhead';
import { BigBox, CutIdeas, FixedFlex, Fuel, Grocery, Subscriptions } from './widgets/saveMoney';

export interface WidgetProps { d: DashboardData; size: WidgetSize; view: ViewId }

/** A widget: its catalogue entry, the rule that decides its readiness (computed in core/dashboard.ts), and the component that draws it. */
export interface WidgetDef extends WidgetMeta {
  readiness: (data: DashboardData) => Readiness;
  Component: ComponentType<WidgetProps>;
}

const COMPONENTS: Record<WidgetId, ComponentType<WidgetProps>> = {
  kpis: Kpis, cashflow: Cashflow, donut: Donut, trend: Trend, oneTime: OneTime,
  cutIdeas: CutIdeas, fixedFlex: FixedFlex, subscriptions: Subscriptions, grocery: Grocery, bigbox: BigBox, fuel: Fuel,
  forecast: Forecast, forecastBuild: ForecastBuild, pace: Pace, billsOnce: BillsOnce,
  bizSummary: BizSummary, bizPending: BizPending, bizDonut: BizDonut, bizTools: BizTools, bizPL: BizPL,
  attention: Attention, dataHealth: DataHealth,
};

export const REGISTRY: Record<WidgetId, WidgetDef> = Object.fromEntries(
  (Object.keys(COMPONENTS) as WidgetId[]).map((id) => [id, { ...META[id], readiness: (data: DashboardData) => data[id].readiness, Component: COMPONENTS[id] }]),
) as Record<WidgetId, WidgetDef>;
