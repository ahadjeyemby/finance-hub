import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Defs, Line, Path, Pattern, Rect } from 'react-native-svg';

import { dollars } from '@/core/queries';
import { F, R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { H, Row, T } from '@/theme/ui';

/** Measure the available width, render nothing until known. */
export function Measured({ children, height }: { children: (w: number) => ReactNode; height?: number }) {
  const [w, setW] = useState(0);
  return (
    <View onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))} style={{ width: '100%', minHeight: height }}>
      {w > 0 ? children(w) : null}
    </View>
  );
}

/** Compact money for axes: $1.2k, $320. Values are cents. */
export const axisMoney = (cents: number) => {
  const d = Math.abs(cents) / 100;
  const s = d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : `${Math.round(d)}`;
  return `${cents < 0 ? '-' : ''}$${s}`;
};

export function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function HatchDefs({ id, color }: { id: string; color: string }) {
  const C = useColors();
  return (
    <Defs>
      <Pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <Rect width={6} height={6} fill={C.paper} />
        <Rect width={3} height={6} fill={color} />
      </Pattern>
    </Defs>
  );
}

export function Grid({ w, h, left, top, ticks, max, min = 0 }: { w: number; h: number; left: number; top: number; ticks: number; max: number; min?: number }) {
  const C = useColors();
  return (
    <>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const y = top + h - (h * i) / ticks;
        return <Line key={i} x1={left} x2={w} y1={y} y2={y} stroke={C.line} strokeWidth={1} />;
      })}
    </>
  );
}

export function Legend({ items }: { items: { label: string; color: string; hatch?: boolean }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, columnGap: S.md }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: it.color }} />
          <T size={12} tone="ink2">{it.label}</T>
        </View>
      ))}
    </View>
  );
}

/** One-line readout used instead of hover on touch screens. */
export function Readout({ label, value, note }: { label?: string; value?: string; note?: string }) {
  const C = useColors();
  return (
    <View style={{ minHeight: 38, justifyContent: 'center' }} accessibilityLiveRegion="polite">
      {label ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: S.sm, flexWrap: 'wrap' }}>
          <T bold size={14}>{label}</T>
          <Text style={{ fontFamily: F.display, fontSize: 18, color: C.ink }}>{value}</Text>
          {note ? <T size={12} tone="ink3">{note}</T> : null}
        </View>
      ) : <T size={12} tone="ink3">Tap a mark for details.</T>}
    </View>
  );
}

/** Card wrapper with the mandatory table view for every chart. */
export function ChartCard({ title, subtitle, rows, children }: { title: string; subtitle?: string; rows?: { label: string; value: number; extra?: string }[]; children: ReactNode }) {
  const C = useColors();
  const [table, setTable] = useState(false);
  return (
    <View style={{ backgroundColor: C.paper, borderRadius: R.card, borderWidth: 1, borderColor: C.line, padding: 22, gap: S.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: S.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <H size={16}>{title}</H>
          {subtitle ? <T size={12} tone="ink3">{subtitle}</T> : null}
        </View>
        {rows ? (
          <Pressable accessibilityRole="button" onPress={() => setTable(!table)} style={{ minHeight: 36, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
            <T size={12} bold tone="ink2">{table ? 'Chart' : 'Table'}</T>
          </Pressable>
        ) : null}
      </View>
      {table && rows ? (
        <View style={{ gap: 6 }}>
          {rows.map((r, i) => <Row key={`${r.label}${i}`} label={r.label} value={dollars(r.value)} />)}
        </View>
      ) : children}
    </View>
  );
}

export { Path };
