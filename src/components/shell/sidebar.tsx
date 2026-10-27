import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons';
import type { IconName } from '@/components/icons';
import { PoweredBy } from '@/components/poweredby';
import { dayLabel } from '@/core/dates';
import { useRepo } from '@/data/repo';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R, TABULAR } from '@/theme/tokens';
import { initialOf } from './parts';

interface NavItem { route: string; label: string; icon: IconName; badge?: 'questions' }
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Workspace', items: [
    { route: 'index', label: 'Dashboard', icon: 'overview' }, { route: 'explore', label: 'Explore', icon: 'explore' },
    { route: 'inbox', label: 'Inbox', icon: 'inbox', badge: 'questions' }, { route: 'reports', label: 'Reports', icon: 'reports' },
    { route: 'accounts', label: 'Accounts', icon: 'accounts' },
  ] },
  { title: 'Organize', items: [
    { route: 'links', label: 'Receipt links', icon: 'receipt' }, { route: 'recurring', label: 'Recurring', icon: 'recurring' },
    { route: 'income', label: 'Income', icon: 'income' }, { route: 'people', label: 'People', icon: 'people' },
    { route: 'categories', label: 'Categories and tags', icon: 'tags' },
  ] },
];
/** Pages kept for the person who runs the workspace: a Contributor's side bar leaves them out (see components/owneronly.tsx). */
export const OWNER_ROUTES: ReadonlySet<string> = new Set(['accounts', 'income', 'categories']);

/** The side bar on screens 960px and wider: Workspace and Organize, then the statement status, the workspace row and "Powered by Sparktrum". */
export function Sidebar({ state, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { questions, dataTo, completeTo, auth, team, hasData, spendingOnly } = useRepo();
  const current = state.routes[state.index]?.name;
  const go = (name: string) => { const r = state.routes.find((x) => x.name === name); if (r) navigateToTab(r.key); };
  const behind = hasData && completeTo < dataTo;
  return (
    <View accessibilityRole="navigation" accessibilityLabel="Main" style={{ width: 244, backgroundColor: c.side, borderRightWidth: 1, borderRightColor: c.line, paddingBottom: insets.bottom }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 24, paddingHorizontal: 14, paddingBottom: 20, gap: 22 }}>
        {NAV_GROUPS.map((g) => (
          <View key={g.title} style={{ gap: 2 }}>
            <Text accessibilityRole="header" style={{ fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: c.ink3, paddingHorizontal: 12, paddingBottom: 8 }}>{g.title}</Text>
            {g.items.filter((n) => !spendingOnly || !OWNER_ROUTES.has(n.route)).map((n) => {
              const on = current === n.route;
              const badge = n.badge === 'questions' ? questions.length : 0;
              return (
                <Pressable key={n.route} accessibilityRole="link" aria-selected={on} accessibilityLabel={badge ? `${n.label}, ${badge} questions` : n.label} onPress={() => go(n.route)}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: R.md, backgroundColor: on ? c.accentSoft : hovered || pressed ? c.seg : 'transparent' })}>
                  <Icon name={n.icon} color={on ? c.accentInk : c.ink2} size={20} strokeWidth={1.9} />
                  <Text style={{ flex: 1, fontFamily: on ? F.bodyBold : F.bodyMed, fontSize: 15, color: on ? c.accentInk : c.ink2 }}>{n.label}</Text>
                  {badge ? <View style={{ minWidth: 26, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={[{ fontFamily: F.bodyBold, fontSize: 12, color: c.onAccent }, TABULAR]}>{badge}</Text></View> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={{ marginTop: 'auto', gap: 14 }}>
          {hasData ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }} accessibilityLabel={behind ? `Statements through ${dayLabel(dataTo)}; some accounts end on ${dayLabel(completeTo)}` : `Statements through ${dayLabel(dataTo)}`}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: behind ? c.out : c.good }} />
              <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>Statements through {dayLabel(dataTo)}</Text>
            </View>
          ) : null}
          <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 14, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.display, fontSize: 16, color: c.accentInk }}>{initialOf(auth.email)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 15, color: c.ink }}>Your workspace</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 13, color: c.ink3 }}>{team.active ? `${team.members.length + 1} people` : auth.email ?? 'Personal account'}</Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 6 }}><PoweredBy /></View>
        </View>
      </ScrollView>
    </View>
  );
}
