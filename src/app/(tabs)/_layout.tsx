import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { PhoneAppBar, PhoneTabBar } from '@/components/shell/phone';
import { TxPanelProvider } from '@/components/txpanel';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/topbar';
import { useColors } from '@/theme/theme';
import { useWide } from '@/theme/ui';

// Every screen is a tab route, so the side bar (wide) or the tab bar (phone) stays in place on all of them. The bars are drawn by the shell
// components, which list only the destinations the design names; the other routes are reached from the screens that link to them.
const SCREENS: [name: string, title: string][] = [
  ['index', 'Dashboard'], ['explore', 'Explore'], ['add', 'Add'], ['inbox', 'Inbox'], ['reports', 'Reports'], ['accounts', 'Accounts'],
  ['links', 'Receipt links'], ['recurring', 'Recurring'], ['income', 'Income'], ['people', 'People'], ['categories', 'Categories and tags'],
  ['views', 'Tags overview'], ['ledger', 'Transactions'], ['receipt', 'Receipt'], ['txn/[id]', 'Transaction'], ['forecast', 'Forecast'],
  ['prices', 'Prices'], ['ask', 'Ask'], ['cash', 'Cash'], ['import', 'Import'],
];

export default function TabsLayout() {
  const C = useColors();
  const wide = useWide();
  return (
    <TxPanelProvider>
      <View style={{ flex: 1, backgroundColor: C.ground }}>
        {wide ? <TopBar /> : <PhoneAppBar />}
        <Tabs
          // Back returns to the screen the person was on, as a web page does. The default sends every Back to the first tab, the dashboard.
          backBehavior="fullHistory"
          tabBar={(props) => (wide ? <Sidebar {...props} /> : <PhoneTabBar {...props} />)}
          screenOptions={{ headerShown: false, tabBarPosition: wide ? 'left' : 'bottom', sceneStyle: { backgroundColor: C.ground } }}>
          {SCREENS.map(([name, title]) => <Tabs.Screen key={name} name={name} options={{ title }} />)}
        </Tabs>
      </View>
    </TxPanelProvider>
  );
}
