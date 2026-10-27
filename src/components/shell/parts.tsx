import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icons';
import { useRepo } from '@/data/repo';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R, TABULAR } from '@/theme/tokens';

/** The first letter of the signed-in person's email, or "Y" (you) when no one is signed in. */
export function initialOf(email: string | null | undefined): string {
  const c = email?.trim()[0];
  return c ? c.toUpperCase() : 'Y';
}

/** The round avatar button. It opens Accounts, where the data and the sign-in live. */
export function AvatarButton() {
  const { c } = useTheme();
  const { auth } = useRepo();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Your account" onPress={() => router.navigate('/accounts')}
      style={({ pressed }) => ({ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ fontFamily: F.display, fontSize: 16, color: c.ctaInk }}>{initialOf(auth.email)}</Text>
    </Pressable>
  );
}

/** A square 44px icon button with a hairline border. */
export function IconButton({ icon, label, onPress, badge }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onPress: () => void; badge?: number }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: R.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
      <Icon name={icon} color={c.ink2} size={20} />
      {badge ? <CountBadge n={badge} style={{ position: 'absolute', top: -6, right: -6 }} /> : null}
    </Pressable>
  );
}

export function CountBadge({ n, style }: { n: number; style?: object }) {
  const { c } = useTheme();
  return (
    <View style={[{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: c.accent, borderWidth: 2, borderColor: c.paper, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={[{ fontFamily: F.bodyBold, fontSize: 11, color: c.onAccent }, TABULAR]}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

export function ThemeToggle() {
  const { scheme, toggle } = useTheme();
  return <IconButton icon={scheme === 'dark' ? 'sun' : 'moon'} label={scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onPress={toggle} />;
}

/** "Ask about your money": opens the Ask screen with the question already sent. */
export function AskField({ compact }: { compact?: boolean }) {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const send = () => { const text = q.trim(); if (!text) { router.navigate('/ask'); return; } setQ(''); router.navigate({ pathname: '/ask', params: { q: text } }); };
  return (
    <View accessibilityRole="search" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingLeft: compact ? 14 : 16, paddingRight: 4, borderRadius: 14, backgroundColor: c.field, borderWidth: 1, borderColor: c.line }}>
      <Icon name="search" color={c.ink3} size={20} />
      <TextInput value={q} onChangeText={setQ} onSubmitEditing={send} returnKeyType="search" accessibilityLabel="Ask about your money"
        placeholder={compact ? 'Ask: “fuel in August”' : 'Ask about your money: “fuel in August”, “what changed since July”'} placeholderTextColor={c.ink3}
        style={{ flex: 1, minWidth: 0, minHeight: MIN_TOUCH, fontFamily: F.body, fontSize: 15, color: c.ink }} />
      {compact ? null : (
        <Pressable accessibilityRole="button" accessibilityLabel="Ask" onPress={send}
          style={({ pressed }) => ({ minHeight: MIN_TOUCH, minWidth: 52, paddingHorizontal: 14, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.accentInk }}>Ask</Text>
        </Pressable>
      )}
    </View>
  );
}
