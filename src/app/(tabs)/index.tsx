import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { PoweredBy } from '@/components/poweredby';
import { AskField } from '@/components/shell/parts';
import { META } from '@/dashboard/catalog';
import { CustomizePanel } from '@/dashboard/customize';
import { WidgetGrid } from '@/dashboard/grid';
import { DashboardHeader } from '@/dashboard/header';
import { resolveView, toggleWidget } from '@/dashboard/layout';
import { isViewId } from '@/dashboard/views';
import { useWidgetPrefs } from '@/data/dashboardPrefs';
import { Banner, Card, H, Screen, T, useWide } from '@/theme/ui';

export default function Dashboard() {
  const wide = useWide();
  const params = useLocalSearchParams<{ view?: string }>();
  const view = isViewId(params.view) ? params.view : 'overview';
  const prefs = useWidgetPrefs();
  const [customizing, setCustomizing] = useState(false);
  const rows = prefs.prefs[view];
  const placed = resolveView(view, rows);

  return (
    <Screen max={1280}>
      {wide ? null : <AskField compact />}
      <DashboardHeader view={view} onView={(v) => router.setParams({ view: v })} onCustomize={() => setCustomizing(true)} />
      {prefs.error ? <Banner title="Your widget choices could not be saved.">{prefs.error} They are kept on this device and saved again with your next change.</Banner> : null}
      <WidgetGrid items={placed} render={(p) => (
        <Card style={{ flex: 1 }}>
          <H size={16}>{META[p.id].name}</H>
          <T size={13} tone="ink3">{META[p.id].chartKind}, size {p.size}</T>
        </Card>
      )} />
      {placed.length ? null : <Card><T tone="ink2">Every widget is switched off in this view. Open Customize to choose some.</T></Card>}
      {wide ? null : <View style={{ alignItems: 'center', paddingTop: 8 }}><PoweredBy /></View>}
      <CustomizePanel visible={customizing} view={view} on={new Set(placed.map((p) => p.id))} readiness={{}}
        onToggle={(id, on) => prefs.save(view, toggleWidget(view, rows, id, on))} onReset={() => prefs.reset(view)} onClose={() => setCustomizing(false)} />
    </Screen>
  );
}
