import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { C, S } from '@/theme/tokens';
import { H, T } from '@/theme/ui';
import { Icon } from './icons';

export function ScreenHeader({ title, sub, back, right }: { title: string; sub?: string; back?: boolean; right?: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
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
