import { router } from 'expo-router';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { Icon } from '@/components/icons';
import type { ActionKind, Ask, Lock, State } from '@/core/dashboard';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R, TABULAR } from '@/theme/tokens';
import { ReadinessBadge } from './badge';

export type GoKind = ActionKind | 'prices' | 'recurring' | 'explore' | 'forecast' | 'ledger';
const ROUTES: Record<GoKind, Href> = {
  import: { pathname: '/import', params: { kind: 'statement' } },
  receipts: { pathname: '/import', params: { kind: 'receipt' } },
  income: '/income', inbox: '/inbox', categories: '/categories', accounts: '/accounts',
  prices: '/prices', recurring: '/recurring', explore: '/explore', forecast: '/forecast', ledger: '/ledger',
};
export const go = (kind: GoKind) => router.push(ROUTES[kind]);
/** The Inbox, showing only the questions behind a widget when there are some. */
export const openInbox = (ids: string[] = []) => router.push(ids.length ? { pathname: '/inbox', params: { only: ids.join(',') } } : '/inbox');

/** The card every widget sits in: radius 22, hairline border, 22px padding, a Sora title and a one-line caption. */
export function WidgetCard({ title, sub, right, children, gap = 14, style, dashed }: { title?: string; sub?: string; right?: ReactNode; children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; dashed?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: c.paper, borderWidth: 1, borderStyle: dashed ? 'dashed' : 'solid', borderColor: dashed ? c.line2 : c.line, borderRadius: R.card, padding: 22, gap }, style]}>
      {title ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={{ fontFamily: F.display, fontSize: 18, color: c.ink }}>{title}</Text>
            {sub ? <Text style={{ marginTop: 3, fontFamily: F.body, fontSize: 13, color: c.ink3 }}>{sub}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A text link in the accent ink, 44px tall. */
export function LinkButton({ label, onPress, align = 'flex-start' }: { label: string; onPress: () => void; align?: ViewStyle['alignSelf'] }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={{ minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: align }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.accentInk }}>{label}</Text>
    </Pressable>
  );
}

/** A full-width button: solid accent for the main action, otherwise outlined. */
export function WideButton({ label, onPress, solid, accessibilityLabel }: { label: string; onPress: () => void; solid?: boolean; accessibilityLabel?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
      style={({ pressed }) => ({ marginTop: 'auto', minHeight: solid ? 48 : MIN_TOUCH, borderRadius: R.md, borderWidth: solid ? 0 : 1, borderColor: c.line2, backgroundColor: solid ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: solid ? 15 : 14, color: solid ? c.onAccent : c.ink }}>{label}</Text>
    </Pressable>
  );
}

/** A small rounded chip at the top right of a widget. */
export function Chip({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'warn' | 'good' | 'neutral' }) {
  const { c } = useTheme();
  const bg = tone === 'accent' ? c.accentSoft : tone === 'warn' ? c.warnBg : tone === 'good' ? c.goodSoft : c.seg;
  const ink = tone === 'accent' ? c.accentInk : tone === 'warn' ? c.warnInk : tone === 'good' ? c.goodInk : c.ink2;
  return <View style={{ minHeight: 26, paddingHorizontal: 10, borderRadius: 8, backgroundColor: bg, justifyContent: 'center' }}><Text style={[{ fontFamily: F.bodyBold, fontSize: 12, color: ink }, TABULAR]}>{label}</Text></View>;
}

/** The warning strip: an alert icon and a sentence, in the warning colours. */
export function WarnNote({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: 'auto', flexDirection: 'row', gap: 10, backgroundColor: c.warnBg, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12 }}>
      <View style={{ marginTop: 1 }}><Icon name="alert" color={c.warnInk} size={18} strokeWidth={2.2} /></View>
      <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, lineHeight: 19, color: c.warnInk }}>{children}</Text>
    </View>
  );
}

/** "Needs your answers": the chart stays, with this prompt above it and the way to the questions behind it. */
export function AskStrip({ ask, action }: { ask: Ask; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.warnBg, borderRadius: R.md, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 2 }}>
      <Text style={{ flex: 1, minWidth: 180, fontFamily: F.body, fontSize: 13, lineHeight: 19, color: c.warnInk }}><Text style={{ fontFamily: F.bodyBold }}>Needs your answers. </Text>{ask.text}</Text>
      {action ?? (ask.questionIds.length ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`Answer ${ask.questionIds.length === 1 ? 'the question' : `the ${ask.questionIds.length} questions`} in the Inbox`} onPress={() => openInbox(ask.questionIds)} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: c.warnInk, textDecorationLine: 'underline' }}>Answer in Inbox</Text>
        </Pressable>
      ) : null)}
    </View>
  );
}

export type GhostKind = 'bars' | 'ring' | 'line' | 'list' | 'split' | 'numbers' | 'range' | 'table' | 'waterfall';

/** A dashed outline of the chart that would be here. */
function Ghost({ kind }: { kind: GhostKind }) {
  const { c } = useTheme();
  const dash = { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: c.line2 };
  if (kind === 'ring') return <View style={{ alignSelf: 'center', width: 150, height: 150, borderRadius: 75, ...dash }} />;
  if (kind === 'split' || kind === 'range') return <View style={{ marginTop: 40, height: 22, borderRadius: 10, ...dash }} />;
  if (kind === 'line') return <View style={{ flex: 1, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: c.line2 }}><View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, ...dash, borderWidth: 0, borderTopWidth: 2, transform: [{ rotate: '-14deg' }, { translateY: 90 }] }} /></View>;
  if (kind === 'list' || kind === 'table') return <View style={{ gap: 10, paddingTop: 6 }}>{[0, 1, 2, 3].map((i) => <View key={i} style={{ height: 34, borderRadius: 10, ...dash, opacity: 1 - i * 0.18 }} />)}</View>;
  if (kind === 'numbers') return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{[0, 1, 2, 3].map((i) => <View key={i} style={{ flexGrow: 1, flexBasis: 140, height: 120, borderRadius: R.card, ...dash }} />)}</View>;
  const heights = kind === 'waterfall' ? [150, 110, 40] : [110, 150, 80, 130];
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', gap: 16, borderBottomWidth: 2, borderStyle: 'dashed', borderColor: c.line2, paddingHorizontal: 12 }}>
      {heights.map((h, i) => <View key={i} style={{ flexShrink: 1, flexBasis: 70, height: h, borderTopLeftRadius: 10, borderTopRightRadius: 10, ...dash, borderBottomWidth: 0 }} />)}
    </View>
  );
}

/** "Needs more data": the dashed chart, a centred card saying what is missing, and the one action that unlocks it. */
function Locked({ lock, ghost }: { lock: Lock; ghost: GhostKind }) {
  const { c } = useTheme();
  return (
    <>
      <View aria-hidden style={{ height: ghost === 'numbers' ? 252 : 200, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}><Ghost kind={ghost} /></View>
      </View>
      <View style={{ marginTop: -150, marginBottom: 40, alignSelf: 'center', width: '90%', maxWidth: 340, backgroundColor: c.paper, borderWidth: 1, borderColor: c.line, borderRadius: R.lg, padding: 16, flexDirection: 'row', gap: 10 }}>
        <Icon name="lock" color={c.ink3} size={18} />
        <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, lineHeight: 21, color: c.ink2 }}><Text style={{ fontFamily: F.bodyBold, color: c.ink }}>Needs more data. </Text>{lock.missing}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => go(lock.action.kind)}
        style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: MIN_TOUCH, paddingHorizontal: 16, borderRadius: R.md, borderWidth: 1, borderColor: c.line2, justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }}>{lock.action.label}</Text>
      </Pressable>
    </>
  );
}

/**
 * A widget in one of its three states. Ready shows `children`; Needs your answers shows `children` under a prompt that leads to the questions
 * (or `askAction`, for widgets answered in place); Needs more data replaces the chart with its dashed outline and what unlocks it.
 */
export function Widget({ title, sub, right, state, ghost, children, gap, askAction }: { title: string; sub?: string; right?: ReactNode; state: State; ghost: GhostKind; children?: ReactNode; gap?: number; askAction?: ReactNode }) {
  if (state.readiness === 'data' && state.lock) {
    return <WidgetCard title={title} sub={sub} right={<ReadinessBadge value="data" size="md" />} gap={gap}><Locked lock={state.lock} ghost={ghost} /></WidgetCard>;
  }
  return (
    <WidgetCard title={title} sub={sub} right={right} gap={gap}>
      {state.readiness === 'answers' && state.ask ? <AskStrip ask={state.ask} action={askAction} /> : null}
      {children}
    </WidgetCard>
  );
}
