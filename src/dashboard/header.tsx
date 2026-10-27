import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icons';
import { monthLabel } from '@/core/dates';
import { useRepo } from '@/data/repo';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R } from '@/theme/tokens';
import { useWide } from '@/theme/ui';
import { VIEWS, VIEW_IDS } from './views';
import type { ViewId } from './views';

/** Every month that has statements, and All. It scrolls sideways when there are many. */
export function MonthPicker() {
  const { c } = useTheme();
  const { months, period, setPeriod } = useRepo();
  // months from more than one year carry the year, so two Junes are never confused
  const years = new Set(months.map((m) => m.slice(0, 4))).size > 1;
  const shown = [...months.map((m) => ({ value: m, label: years ? `${monthLabel(m, true)} ’${m.slice(2, 4)}` : monthLabel(m, true), long: monthLabel(m) })), { value: 'all', label: 'All', long: 'All months' }];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: '100%' }} contentContainerStyle={{ flexGrow: 0 }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Month" style={{ flexDirection: 'row', gap: 2, padding: 4, borderRadius: R.lg, backgroundColor: c.paper, borderWidth: 1, borderColor: c.line }}>
        {shown.map((m) => {
          const on = period === m.value;
          return (
            <Pressable key={m.value} accessibilityRole="radio" aria-checked={on} accessibilityLabel={m.long} onPress={() => setPeriod(m.value)}
              style={{ minHeight: MIN_TOUCH, minWidth: 52, paddingHorizontal: 12, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accent : 'transparent' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 14, color: on ? c.onAccent : c.ink2 }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function CustomizeButton({ onPress, compact }: { onPress: () => void; compact?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Customize this view" onPress={onPress}
      style={({ pressed }) => ({ minHeight: compact ? MIN_TOUCH : 52, paddingHorizontal: compact ? 14 : 18, borderRadius: compact ? R.md : 14, borderWidth: 1, borderColor: c.line2, backgroundColor: c.paper, flexDirection: 'row', alignItems: 'center', gap: compact ? 6 : 8, opacity: pressed ? 0.85 : 1 })}>
      <Icon name="sliders" color={c.ink} size={compact ? 16 : 18} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }}>Customize</Text>
    </Pressable>
  );
}

/** Overview, Household, Business and Plan ahead, plus "New view" (not in this release), and the line that says what the chosen view is for. */
export function ViewTabs({ view, onChange }: { view: ViewId; onChange: (v: ViewId) => void }) {
  const { c } = useTheme();
  const wide = useWide();
  const tabs = VIEW_IDS.map((id) => {
    const v = VIEWS[id];
    const on = id === view;
    return (
      <Pressable key={id} accessibilityRole="tab" aria-selected={on} onPress={() => onChange(id)}
        style={{ minHeight: wide ? 48 : MIN_TOUCH, paddingLeft: wide ? 14 : 16, paddingRight: wide ? 18 : 16, borderRadius: wide ? 14 : 22, borderWidth: on ? 2 : 1, borderColor: on ? c.accent : c.line2, backgroundColor: on ? c.paper : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {wide ? <Icon name={v.icon} color={on ? c.accentInk : c.ink2} size={20} strokeWidth={1.9} /> : null}
        <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: wide ? 15 : 14, color: on ? c.accentInk : c.ink2 }}>{v.label}</Text>
      </Pressable>
    );
  });
  const newView = (
    <View accessible accessibilityRole="button" aria-disabled={true} accessibilityLabel="New view, coming soon" accessibilityHint="Custom views are not available yet"
      style={{ minHeight: wide ? 48 : MIN_TOUCH, paddingHorizontal: 16, borderRadius: wide ? 14 : 22, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="add" color={c.ink3} size={16} strokeWidth={2.4} />
      <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: c.ink3 }}>New view</Text>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: c.ink3, backgroundColor: c.seg, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' }}>Coming soon</Text>
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      {wide ? (
        <View accessibilityRole="tablist" accessibilityLabel="Dashboard view" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{tabs}{newView}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} accessibilityRole="tablist" accessibilityLabel="Dashboard view">{tabs}{newView}</ScrollView>
      )}
      <Text style={{ fontFamily: F.body, fontSize: wide ? 15 : 14, lineHeight: wide ? 21 : 20, color: c.ink2 }}>{VIEWS[view].blurb}</Text>
    </View>
  );
}

/** The top of the dashboard: the eyebrow and title, the month picker and Customize, then the view tabs. */
export function DashboardHeader({ view, onView, onCustomize }: { view: ViewId; onView: (v: ViewId) => void; onCustomize: () => void }) {
  const { c } = useTheme();
  const wide = useWide();
  if (!wide) {
    return (
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 28, letterSpacing: -0.6, color: c.ink }}>Dashboard</Text>
          <CustomizeButton compact onPress={onCustomize} />
        </View>
        <MonthPicker />
        <ViewTabs view={view} onChange={onView} />
      </View>
    );
  }
  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', columnGap: 24, rowGap: 16 }}>
        <View>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: c.ink2 }}>Your money, a little clearer.</Text>
          <Text accessibilityRole="header" style={{ marginTop: 4, fontFamily: F.display, fontSize: 40, letterSpacing: -1.2, lineHeight: 44, color: c.ink }}>Dashboard</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <MonthPicker />
          <CustomizeButton onPress={onCustomize} />
        </View>
      </View>
      <ViewTabs view={view} onChange={onView} />
    </View>
  );
}
