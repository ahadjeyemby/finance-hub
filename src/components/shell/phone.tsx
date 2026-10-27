import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo, Wordmark } from '@/components/brand';
import { Icon } from '@/components/icons';
import type { IconName } from '@/components/icons';
import { useRepo } from '@/data/repo';
import { useTheme } from '@/theme/theme';
import { F } from '@/theme/tokens';
import { AvatarButton, CountBadge, ThemeToggle } from './parts';

/** Phones (under 960px): logo, theme toggle and avatar. */
export function PhoneAppBar() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.paper, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <View style={{ height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 12 }}>
        <Pressable accessibilityRole="link" accessibilityLabel="Finora, go to the dashboard" onPress={() => router.navigate('/')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <Logo size={38} />
          <Wordmark width={88} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <ThemeToggle />
          <AvatarButton />
        </View>
      </View>
    </View>
  );
}

const TABS: { route: string; label: string; icon: IconName }[] = [
  { route: 'index', label: 'Dashboard', icon: 'overview' },
  { route: 'explore', label: 'Explore', icon: 'explore' },
  { route: 'add', label: 'Add', icon: 'add' },
  { route: 'reports', label: 'Reports', icon: 'reports' },
  { route: 'inbox', label: 'Inbox', icon: 'inbox' },
];

/** The phone tab bar: Dashboard, Explore, Add (a raised round button), Reports, Inbox with its count. */
export function PhoneTabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { questions } = useRepo();
  const current = state.routes[state.index]?.name;
  const go = (name: string) => { const r = state.routes.find((x) => x.name === name); if (r) navigateToTab(r.key); };
  return (
    <View accessibilityRole="tablist" accessibilityLabel="Main" style={{ backgroundColor: c.paper, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: 6, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around' }}>
      {TABS.map((t) => {
        const on = current === t.route;
        if (t.route === 'add') {
          return (
            <Pressable key={t.route} accessibilityRole="button" accessibilityLabel="Add" onPress={() => go('add')}
              style={({ pressed }) => ({ width: 58, height: 58, marginTop: -24, borderRadius: 29, backgroundColor: c.accent, borderWidth: 4, borderColor: c.ground, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Icon name="add" color={c.onAccent} size={26} strokeWidth={2.6} />
            </Pressable>
          );
        }
        const badge = t.route === 'inbox' ? questions.length : 0;
        return (
          <Pressable key={t.route} accessibilityRole="tab" aria-selected={on} accessibilityLabel={badge ? `${t.label}, ${badge} questions` : t.label} onPress={() => go(t.route)}
            style={{ width: 66, minHeight: 52, alignItems: 'center', gap: 3 }}>
            <Icon name={t.icon} color={on ? c.accentInk : c.ink3} size={24} />
            <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12, color: on ? c.accentInk : c.ink3 }}>{t.label}</Text>
            {badge ? <CountBadge n={badge} style={{ position: 'absolute', top: -4, right: 4 }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
