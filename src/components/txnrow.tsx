import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { categoryLabel } from '@/core/categories';
import { dayLabel } from '@/core/dates';
import { dollars } from '@/core/queries';
import type { Txn } from '@/core/types';
import { C, S } from '@/theme/tokens';
import { T } from '@/theme/ui';

export function TxnRow({ t }: { t: Txn }) {
  const sub = [dayLabel(t.date), t.kind === 'transfer' ? 'Transfer' : t.kind === 'income' ? 'Income' : t.kind === 'rewards' ? 'Rewards' : categoryLabel(t.category)];
  if (t.business) sub.push('Business');
  if (t.oneOff) sub.push('One-time');
  if (t.lines?.length) sub.push(`${t.lines.length} items`);
  const money = t.kind === 'transfer' ? dollars(Math.abs(t.cents)) : dollars(t.cents, { sign: true });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t.merchant}, ${money}, ${sub.join(', ')}`} onPress={() => router.push({ pathname: '/txn/[id]', params: { id: t.id } })}
      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: S.sm, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <View style={{ flex: 1, gap: 1 }}>
        <T size={14} bold numberOfLines={1}>{t.merchant}</T>
        <T size={12} tone="ink3" numberOfLines={1}>{sub.join('  /  ')}</T>
      </View>
      <T size={14} bold tone={t.cents > 0 && t.kind !== 'transfer' ? 'good' : 'ink'}>{money}</T>
    </Pressable>
  );
}
