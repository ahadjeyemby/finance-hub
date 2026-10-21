import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo, Wordmark } from '@/components/brand';
import { S } from '@/theme/tokens';
import { T } from '@/theme/ui';

/** Room the brand takes at the top and the bottom of the side bar, so the tabs sit between them. */
export const SIDEBAR_TOP = 76;
export const SIDEBAR_BOTTOM = 52;

/**
 * The Finora logo at the top of the side bar and the line "Powered by Sparktrum" at the bottom. It is drawn as the bar's background, so it never
 * takes a tap and the tabs are untouched; the bar leaves room for it (SIDEBAR_TOP and SIDEBAR_BOTTOM above, plus the safe area).
 */
export function SidebarBrand() {
  const inset = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingTop: inset.top + S.lg, paddingHorizontal: S.lg }}>
        <Logo size={36} />
        <Wordmark width={92} />
      </View>
      <View style={{ paddingBottom: inset.bottom + S.lg, paddingHorizontal: S.lg }}>
        <T size={11} tone="ink3">Powered by Sparktrum</T>
      </View>
    </View>
  );
}
