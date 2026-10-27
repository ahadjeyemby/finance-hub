import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { categoryLabel } from '@/core/categories';
import { dayLabel } from '@/core/dates';
import { dollars } from '@/core/queries';
import type { Txn } from '@/core/types';
import { useRepo } from '@/data/repo';
import { S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { T } from '@/theme/ui';

export function TxnRow({ t }: { t: Txn }) {
  const C = useColors();
  const { tagState } = useRepo();
  const sub = [dayLabel(t.date), t.kind === 'transfer' ? 'Transfer' : t.kind === 'income' ? 'Income' : t.kind === 'rewards' ? 'Rewards' : categoryLabel(t.category)];
  // for money coming in, the bank's own wording and the account say where it came from
  if (t.kind === 'income') sub.push(t.subtype === 'unconfirmed' ? 'Unconfirmed' : t.subtype === 'salary' ? 'Salary' : 'Other deposit', t.description);
  if (t.business) sub.push('Business');
  if (t.oneOff) sub.push('One-time');
  if (t.lines?.length) sub.push(`${t.lines.length} items`);
  if (t.tags?.length) sub.push(t.tags.slice(0, 3).map((id) => tagState.defs.find((d) => d.id === id)?.label ?? id).join(', '));
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
