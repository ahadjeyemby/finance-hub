import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { PoweredBy } from '@/components/poweredby';
import { AskField } from '@/components/shell/parts';
import { WIDGET_IDS } from '@/dashboard/catalog';
import type { Readiness, WidgetId } from '@/dashboard/catalog';
import { CustomizePanel } from '@/dashboard/customize';
import { WidgetGrid } from '@/dashboard/grid';
import { DashboardHeader } from '@/dashboard/header';
import { resolveView, toggleWidget } from '@/dashboard/layout';
import { REGISTRY } from '@/dashboard/registry';
import { useDashboardData } from '@/dashboard/useDashboardData';
import { VIEWS, isViewId } from '@/dashboard/views';
import { useWidgetPrefs } from '@/data/dashboardPrefs';
import { Banner, Card, Screen, T, useWide } from '@/theme/ui';

export default function Dashboard() {
  const wide = useWide();
  const params = useLocalSearchParams<{ view?: string }>();
  const view = isViewId(params.view) ? params.view : 'overview';
  const prefs = useWidgetPrefs();
  const [customizing, setCustomizing] = useState(false);
  const rows = prefs.prefs[view];
  const placed = resolveView(view, rows);
  // every widget in a view counts that view's spending: Overview everything, Household and Plan ahead personal, Business business
  const data = useDashboardData(VIEWS[view].scope);
  const readiness = Object.fromEntries(WIDGET_IDS.map((id) => [id, REGISTRY[id].readiness(data)])) as Record<WidgetId, Readiness>;

  return (
    <Screen max={1280}>
      {wide ? null : <AskField compact />}
      <DashboardHeader view={view} onView={(v) => router.setParams({ view: v })} onCustomize={() => setCustomizing(true)} />
      {prefs.error ? <Banner title="Your widget choices are not in sync.">{prefs.error} They are kept on this device and sent again with your next change.</Banner> : null}
      <WidgetGrid items={placed} render={(p) => { const { Component } = REGISTRY[p.id]; return <Component d={data} size={p.size} view={view} />; }} />
      {placed.length ? null : <Card><T tone="ink2">Every widget is switched off in this view. Open Customize to choose some.</T></Card>}
      {wide ? null : <View style={{ alignItems: 'center', paddingTop: 8 }}><PoweredBy /></View>}
      <CustomizePanel visible={customizing} view={view} on={new Set(placed.map((p) => p.id))} readiness={readiness}
        onToggle={(id, on) => prefs.save(view, toggleWidget(view, rows, id, on))} onReset={() => prefs.reset(view)} onClose={() => setCustomizing(false)} />
    </Screen>
  );
}
