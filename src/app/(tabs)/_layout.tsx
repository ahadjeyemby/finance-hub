import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { Icon } from '@/components/icons';
import type { IconName } from '@/components/icons';
import { useRepo } from '@/data/repo';
import { C, F, WIDE } from '@/theme/tokens';
import { H, useWide } from '@/theme/ui';

const tab = (title: string, icon: IconName, badge?: number) => ({
  title,
  tabBarIcon: ({ color }: { color: unknown }) => <Icon name={icon} color={String(color)} />,
  tabBarBadge: badge && badge > 0 ? badge : undefined,
});
// Detail routes stay navigable (so the side bar remains) but get no tab button.
const hidden = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const }, title: '' };

export default function TabsLayout() {
  const wide = useWide();
  const { questions } = useRepo();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: C.ink,
        tabBarInactiveTintColor: C.ink3,
        tabBarActiveBackgroundColor: wide ? C.soft : undefined,
        tabBarLabelStyle: { fontFamily: F.bodyBold, fontSize: 12 },
        tabBarBadgeStyle: { backgroundColor: C.signal, color: C.signalInk, fontFamily: F.bodyBold },
        tabBarStyle: { backgroundColor: C.paper, borderColor: C.line, minWidth: wide ? 200 : undefined, ...(wide ? {} : { height: 68, paddingTop: 6, paddingBottom: 10 }) },
        sceneStyle: { backgroundColor: C.ground },
      }}>
      <Tabs.Screen name="index" options={tab('Overview', 'overview')} />
      <Tabs.Screen name="explore" options={tab('Explore', 'explore')} />
      <Tabs.Screen name="add" options={tab('Add', 'add')} />
      <Tabs.Screen name="inbox" options={tab('Inbox', 'inbox', questions.length)} />
      <Tabs.Screen name="reports" options={tab('Reports', 'reports')} />
      <Tabs.Screen name="accounts" options={tab('Accounts', 'accounts')} />
      {/* on a phone the bottom bar is full: Receipt links stay reachable from the Overview and Import */}
      <Tabs.Screen name="links" options={wide ? tab('Receipt links', 'links') : hidden} />
      <Tabs.Screen name="views" options={wide ? tab('Views', 'views') : hidden} />
      <Tabs.Screen name="categories" options={wide ? tab('Categories and tags', 'tags') : hidden} />
      <Tabs.Screen name="ledger" options={hidden} />
      <Tabs.Screen name="txn/[id]" options={hidden} />
      <Tabs.Screen name="forecast" options={hidden} />
      <Tabs.Screen name="prices" options={hidden} />
      <Tabs.Screen name="ask" options={hidden} />
      <Tabs.Screen name="cash" options={hidden} />
      <Tabs.Screen name="import" options={hidden} />
    </Tabs>
  );
}
export { H, View, WIDE };
