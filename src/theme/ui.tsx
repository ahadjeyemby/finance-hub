import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { C, F, MIN_TOUCH, R, S, WIDE } from './tokens';

export const useWide = () => useWindowDimensions().width >= WIDE;

export function Screen({ children, scroll = true, pad = true, max = 1120 }: { children: ReactNode; scroll?: boolean; pad?: boolean; max?: number }) {
  const wide = useWide();
  const inner = <View style={[{ width: '100%', maxWidth: max, alignSelf: 'center', gap: S.lg }, pad && { padding: wide ? S.xl : S.lg }]}>{children}</View>;
  return scroll
    ? <ScrollView style={{ flex: 1, backgroundColor: C.ground }} contentContainerStyle={{ paddingBottom: S.xxl * 2 }} keyboardShouldPersistTaps="handled">{inner}</ScrollView>
    : <View style={{ flex: 1, backgroundColor: C.ground }}>{inner}</View>;
}

export function H({ children, size = 20, style }: { children: ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[{ fontFamily: F.display, fontSize: size, color: C.ink, letterSpacing: -0.02 * size }, style]}>{children}</Text>;
}

export function T({ children, tone = 'ink', size = 14, bold, style, numberOfLines }: { children: ReactNode; tone?: 'ink' | 'ink2' | 'ink3' | 'bad' | 'good' | 'paper'; size?: number; bold?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const color = tone === 'paper' ? C.paper : tone === 'bad' ? C.bad : tone === 'good' ? C.good : C[tone];
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: bold ? F.bodyBold : F.body, fontSize: size, color, lineHeight: size * 1.4 }, style]}>{children}</Text>;
}

export function Card({ children, style, title, right }: { children: ReactNode; style?: StyleProp<ViewStyle>; title?: string; right?: ReactNode }) {
  return (
    <View style={[{ backgroundColor: C.paper, borderRadius: R.md, padding: S.lg, gap: S.sm }, style]}>
      {title ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}><H size={16}>{title}</H>{right}</View> : null}
      {children}
    </View>
  );
}

/** Torn receipt edge under the headline card. */
export function TapeCard({ children }: { children: ReactNode }) {
  const teeth = 80;
  return (
    <View>
      <View style={{ backgroundColor: C.paper, borderTopLeftRadius: R.md, borderTopRightRadius: R.md, padding: S.lg, gap: S.sm }}>{children}</View>
      <Svg width="100%" height={8} viewBox="0 0 340 8" preserveAspectRatio="none" aria-hidden>
        <Path d={`M0 0 L340 0 ${Array.from({ length: teeth }, (_, i) => `L${340 - (i + 1) * (340 / teeth)} ${i % 2 ? 0 : 8}`).join(' ')} Z`} fill={C.paper} />
      </Svg>
    </View>
  );
}

export function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'bad' | 'good' }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline', gap: S.sm }, strong && { borderTopWidth: 2, borderTopColor: C.ink, paddingTop: S.sm, marginTop: S.xs }]}>
      <T bold={strong}>{label}</T>
      <View style={{ flex: 1, borderBottomWidth: strong ? 0 : 2, borderBottomColor: C.line, borderStyle: 'dotted', transform: [{ translateY: -3 }] }} />
      <T bold tone={tone}>{value}</T>
    </View>
  );
}

export function Button({ label, onPress, kind = 'solid', disabled, small, style }: { label: string; onPress?: () => void; kind?: 'solid' | 'outline' | 'ghost'; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const solid = kind === 'solid';
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [{ minHeight: small ? 36 : MIN_TOUCH, paddingHorizontal: S.lg, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: solid ? C.accent : 'transparent', borderWidth: kind === 'outline' ? 2 : 0, borderColor: C.accent, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: small ? 13 : 14, color: solid ? C.paper : C.accent }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, count }: { label: string; on?: boolean; onPress?: () => void; count?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress}
      style={{ minHeight: MIN_TOUCH - 8, minWidth: 48, paddingHorizontal: S.md, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: on ? C.accent : 'transparent' }}>
      <Text style={{ fontFamily: on ? F.bodyBold : F.bodyMed, fontSize: 13, color: on ? C.paper : C.ink2 }}>{label}</Text>
      {count != null ? <Badge n={count} /> : null}
    </Pressable>
  );
}

export function Badge({ n }: { n: number }) {
  return <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.signal, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.signalInk }}>{n}</Text></View>;
}

export function Banner({ title, children, tone = 'warn' }: { title: string; children?: ReactNode; tone?: 'warn' | 'info' }) {
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: tone === 'warn' ? C.warnBg : C.soft, borderRadius: R.md, padding: S.md, gap: 2 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: tone === 'warn' ? C.warnInk : C.ink }}>{title}</Text>
      {children ? <Text style={{ fontFamily: F.body, fontSize: 13, lineHeight: 18, color: tone === 'warn' ? C.warnInk : C.ink2 }}>{children}</Text> : null}
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: C.soft, borderRadius: R.pill, padding: 3, alignSelf: 'flex-start' }}>
      {options.map((o) => (
        <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)}
          style={{ minHeight: MIN_TOUCH - 8, paddingHorizontal: S.lg, borderRadius: R.pill, justifyContent: 'center', backgroundColor: o.value === value ? C.accent : 'transparent' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: o.value === value ? C.paper : C.ink2 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, alignItems: 'center' }}>{children}</ScrollView>;
}

export const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center' } });
