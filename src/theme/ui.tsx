import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { F, MIN_TOUCH, R, S, TABULAR, WIDE } from './tokens';
import { useColors } from './theme';

export const useWide = () => useWindowDimensions().width >= WIDE;

export function Screen({ children, scroll = true, pad = true, max = 1120 }: { children: ReactNode; scroll?: boolean; pad?: boolean; max?: number }) {
  const C = useColors();
  const wide = useWide();
  const inner = <View style={[{ width: '100%', maxWidth: max, alignSelf: 'center', gap: S.lg }, pad && { padding: wide ? S.xl : S.lg }]}>{children}</View>;
  return scroll
    ? <ScrollView style={{ flex: 1, backgroundColor: C.ground }} contentContainerStyle={{ paddingBottom: S.xxl * 2 }} keyboardShouldPersistTaps="handled">{inner}</ScrollView>
    : <View style={{ flex: 1, backgroundColor: C.ground }}>{inner}</View>;
}

export function H({ children, size = 20, style }: { children: ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  const C = useColors();
  return <Text accessibilityRole="header" style={[{ fontFamily: F.display, fontSize: size, color: C.ink, letterSpacing: -0.02 * size }, style]}>{children}</Text>;
}

export type Tone = 'ink' | 'ink2' | 'ink3' | 'bad' | 'good' | 'paper' | 'accent';

export function T({ children, tone = 'ink', size = 14, bold, style, numberOfLines }: { children: ReactNode; tone?: Tone; size?: number; bold?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const C = useColors();
  const color = tone === 'paper' ? C.paper : tone === 'bad' ? C.bad : tone === 'good' ? C.goodInk : tone === 'accent' ? C.accentInk : C[tone];
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: bold ? F.bodyBold : F.body, fontSize: size, color, lineHeight: size * 1.4 }, style]}>{children}</Text>;
}

/** An amount of money, always in tabular figures. */
export function Money({ children, size = 14, display, tone = 'ink', style }: { children: ReactNode; size?: number; display?: boolean; tone?: Tone; style?: StyleProp<TextStyle> }) {
  const C = useColors();
  const color = tone === 'paper' ? C.paper : tone === 'bad' ? C.bad : tone === 'good' ? C.goodInk : tone === 'accent' ? C.accentInk : C[tone];
  return <Text style={[{ fontFamily: display ? F.display : F.bodyBold, fontSize: size, color, letterSpacing: display ? -0.02 * size : 0 }, TABULAR, style]}>{children}</Text>;
}

export function Card({ children, style, title, right }: { children: ReactNode; style?: StyleProp<ViewStyle>; title?: string; right?: ReactNode }) {
  const C = useColors();
  return (
    <View style={[{ backgroundColor: C.paper, borderRadius: R.card, borderWidth: 1, borderColor: C.line, padding: 22, gap: S.sm }, style]}>
      {title ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}><H size={16}>{title}</H>{right}</View> : null}
      {children}
    </View>
  );
}

/** Torn receipt edge under the headline card. */
export function TapeCard({ children }: { children: ReactNode }) {
  const C = useColors();
  const teeth = 80;
  return (
    <View>
      <View style={{ backgroundColor: C.paper, borderTopLeftRadius: R.card, borderTopRightRadius: R.card, padding: 22, gap: S.sm }}>{children}</View>
      <Svg width="100%" height={8} viewBox="0 0 340 8" preserveAspectRatio="none" aria-hidden>
        <Path d={`M0 0 L340 0 ${Array.from({ length: teeth }, (_, i) => `L${340 - (i + 1) * (340 / teeth)} ${i % 2 ? 0 : 8}`).join(' ')} Z`} fill={C.paper} />
      </Svg>
    </View>
  );
}

export function Row({ label, value, strong, tone, onPress }: { label: string; value: string; strong?: boolean; tone?: 'bad' | 'good'; onPress?: () => void }) {
  const C = useColors();
  const body = (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline', gap: S.sm }, strong && { borderTopWidth: 2, borderTopColor: C.ink, paddingTop: S.sm, marginTop: S.xs }]}>
      <T bold={strong}>{label}</T>
      <View style={{ flex: 1, borderBottomWidth: strong ? 0 : 2, borderBottomColor: C.line, borderStyle: 'dotted', transform: [{ translateY: -3 }] }} />
      <Money tone={tone}>{value}</Money>
      {onPress ? <T bold tone="ink3">›</T> : null}
    </View>
  );
  // a tappable row opens the details behind the number
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${value}, see the transactions behind it`} onPress={onPress} style={{ minHeight: 32, justifyContent: 'center' }}>{body}</Pressable> : body;
}

export function Button({ label, onPress, kind = 'solid', disabled, small, style, accessibilityLabel }: { label: string; onPress?: () => void; kind?: 'solid' | 'outline' | 'ghost' | 'soft'; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const C = useColors();
  const bg = kind === 'solid' ? C.accent : kind === 'soft' ? C.accentSoft : 'transparent';
  const fg = kind === 'solid' ? C.onAccent : C.accentInk;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!disabled }} onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [{ minHeight: small ? 36 : MIN_TOUCH, paddingHorizontal: S.lg, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: kind === 'outline' ? 1.5 : 0, borderColor: C.accent, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: small ? 13 : 14, color: fg }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, count }: { label: string; on?: boolean; onPress?: () => void; count?: number }) {
  const C = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress}
      style={{ minHeight: MIN_TOUCH - 8, minWidth: 48, paddingHorizontal: S.md, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: on ? C.accent : 'transparent' }}>
      <Text style={{ fontFamily: on ? F.bodyBold : F.bodyMed, fontSize: 13, color: on ? C.onAccent : C.ink2 }}>{label}</Text>
      {count != null ? <Badge n={count} /> : null}
    </Pressable>
  );
}

export function Badge({ n }: { n: number }) {
  const C = useColors();
  return <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Text style={[{ fontFamily: F.bodyBold, fontSize: 11, color: C.onAccent }, TABULAR]}>{n}</Text></View>;
}

export function Banner({ title, children, tone = 'warn' }: { title: string; children?: ReactNode; tone?: 'warn' | 'info' }) {
  const C = useColors();
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: tone === 'warn' ? C.warnBg : C.accentSoft, borderRadius: R.lg, padding: S.md, gap: 2 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: tone === 'warn' ? C.warnInk : C.ink }}>{title}</Text>
      {children ? <Text style={{ fontFamily: F.body, fontSize: 13, lineHeight: 18, color: tone === 'warn' ? C.warnInk : C.ink2 }}>{children}</Text> : null}
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label?: string }) {
  const C = useColors();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.seg, borderRadius: R.md, padding: 3, alignSelf: 'flex-start' }}>
      {options.map((o) => (
        <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)}
          style={{ minHeight: MIN_TOUCH - 4, minWidth: 44, paddingHorizontal: S.md, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: o.value === value ? C.accent : 'transparent' }}>
          <Text style={{ fontFamily: o.value === value ? F.bodyBold : F.bodySemi, fontSize: 13, color: o.value === value ? C.onAccent : C.ink2 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, alignItems: 'center' }}>{children}</ScrollView>;
}

/** The style every text field shares: the `field` token with a hairline border. */
export function useInputStyle() {
  const C = useColors();
  return { minHeight: 44, borderRadius: R.md, backgroundColor: C.field, borderWidth: 1, borderColor: C.line, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 15, color: C.ink } as const;
}

export const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center' } });
