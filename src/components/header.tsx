import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { H, T } from '@/theme/ui';
import { Icon } from './icons';

/**
 * Back goes to the screen the person came from. After a page load the app has no history of its own, so on the web the browser's is used;
 * only when there is nothing to go back to does it fall back to the dashboard.
 */
function goBack() {
  if (router.canGoBack()) router.back();
  else if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history.length > 1) window.history.back();
  else router.replace('/');
}

export function ScreenHeader({ title, sub, back, right }: { title: string; sub?: string; back?: boolean; right?: ReactNode }) {
  const C = useColors();
  return (
    <View style={{ gap: 2 }}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
          <Icon name="back" color={C.ink2} size={18} /><T size={13} tone="ink2" bold>Back</T>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap' }}>
        <H size={26}>{title}</H>
        {right}
      </View>
      {sub ? <T size={13} tone="ink3">{sub}</T> : null}
    </View>
  );
}
