import { Text, View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { F } from '@/theme/tokens';
import { READINESS_LABEL } from './catalog';
import type { Readiness } from './catalog';

/** "Ready", "Needs your answers" or "Needs more data", in the colours the brief gives each. */
export function ReadinessBadge({ value, size = 'sm' }: { value: Readiness; size?: 'sm' | 'md' }) {
  const { c } = useTheme();
  const bg = value === 'ready' ? c.goodSoft : value === 'answers' ? c.warnBg : c.seg;
  const ink = value === 'ready' ? c.goodInk : value === 'answers' ? c.warnInk : c.ink2;
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: size === 'sm' ? 7 : 10, paddingVertical: size === 'sm' ? 1 : 3, borderRadius: size === 'sm' ? 6 : 8, backgroundColor: bg }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: size === 'sm' ? 11 : 12, color: ink }}>{READINESS_LABEL[value]}</Text>
    </View>
  );
}
