import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useWide } from '@/theme/ui';
import type { WidgetSize } from './catalog';
import type { Placed } from './layout';

/** The brief's sizes: S grows from 300px, M (twice as eager) from 600px, L takes the whole row. On a phone every widget takes a row. */
export function sizeStyle(size: WidgetSize, wide: boolean): ViewStyle {
  if (!wide || size === 'L') return { width: '100%' };
  return size === 'M' ? { flexGrow: 2, flexShrink: 1, flexBasis: 600, minWidth: 0 } : { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0 };
}

/** The widget area: a wrapping row with 20px gaps. */
export function WidgetGrid({ items, render }: { items: Placed[]; render: (p: Placed) => ReactNode }) {
  const wide = useWide();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: wide ? 20 : 14, alignItems: 'stretch' }}>
      {items.map((p) => <View key={p.id} style={[sizeStyle(p.size, wide), { display: 'flex' }]}>{render(p)}</View>)}
    </View>
  );
}
