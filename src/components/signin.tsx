import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';

import { useRepo } from '@/data/repo';
import { C, F, R, S } from '@/theme/tokens';
import { Button, H, T } from '@/theme/ui';

/** Simple email and password sign-in. Accounts are created by the owner in the Supabase dashboard; there is no sign-up here. */
export function SignIn() {
  const { auth } = useRepo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pw = useRef<TextInputInstance>(null);

  const go = async () => {
    if (busy) return;
    if (!email.trim() || !password) return setErr('Enter your email and password.');
    setBusy(true); setErr('');
    const e = await auth.signIn(email, password);
    setBusy(false);
    if (e) setErr(/invalid login/i.test(e) ? 'Email or password is wrong.' : e);
  };

  const field = { minHeight: 48, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 16, color: C.ink } as const;
  return (
    <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: S.lg }}>
      <View style={{ width: '100%', maxWidth: 400, gap: S.lg }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: F.display, fontSize: 34, letterSpacing: -1, color: C.ink }}>Audit</Text>
          <T tone="ink2">Sign in to open your ledger.</T>
        </View>
        <View style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.lg, gap: S.md }}>
          <H size={16}>Sign in</H>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" returnKeyType="next" onSubmitEditing={() => pw.current?.focus()} placeholder="Email" placeholderTextColor={C.ink3} accessibilityLabel="Email" style={field} />
          <TextInput ref={pw} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={go} placeholder="Password" placeholderTextColor={C.ink3} accessibilityLabel="Password" style={field} />
          {err ? <T size={13} tone="bad">{err}</T> : null}
          <Button label={busy ? 'Signing in' : 'Sign in'} disabled={busy} onPress={go} />
        </View>
        <T size={12} tone="ink3">Your account is created in the Supabase dashboard. Forgot the password? Reset it there under Authentication.</T>
      </View>
    </View>
  );
}
