import { PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sora_600SemiBold, Sora_700Bold, useFonts } from '@expo-google-fonts/sora';
import { Slot, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { NoData } from '@/components/nodata';
import { SignIn } from '@/components/signin';
import { SavedCopyNote } from '@/components/source';
import { ViewSwitch } from '@/components/viewswitch';
import { RepoProvider, useRepo } from '@/data/repo';
import { ThemeProvider, useColors, useTheme } from '@/theme/theme';
import { F } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const C = useColors();
  const { ready, auth, hasData, sync, source } = useRepo();
  const pathname = usePathname();
  const [fonts, fontError] = useFonts({ Sora_600SemiBold, Sora_700Bold, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold });
  useEffect(() => { if (ready && (fonts || fontError)) SplashScreen.hideAsync().catch(() => {}); }, [ready, fonts, fontError]);
  if (!ready || (!fonts && !fontError)) return <View style={{ flex: 1, backgroundColor: C.ground }} />;
  // with a backend configured, nothing is shown until someone signs in
  if (auth.configured && !auth.email) return <SignIn />;
  // no ledger yet. Once the database has answered (and only then), the dashboard opens with every widget locked, each saying what unlocks it;
  // Add and Import are the way out of an empty database, and People is where an invited person joins a workspace. Anything else, and every
  // case where loading has not finished or failed, shows the explanation instead. Nothing is ever filled in with sample data.
  const loadedEmpty = !hasData && ((auth.configured && sync.state === 'synced') || source.kind === 'fixture');
  const open = ['/import', '/people'].concat(loadedEmpty ? ['/', '/add', '/cash', '/accounts'] : []);
  if (!hasData && !open.includes(pathname)) return <NoData />;
  return (
    <View style={{ flex: 1, backgroundColor: C.ground }}>
      {source.kind === 'fixture' ? <View style={{ backgroundColor: C.warnBg, paddingVertical: 4, paddingHorizontal: 12 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.warnInk, textAlign: 'center' }}>Development build: a fictional sample ledger (EXPO_PUBLIC_FIXTURE), not anyone&apos;s real data.</Text></View> : null}
      <SavedCopyNote /><ViewSwitch /><Slot />
    </View>
  );
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function Root() {
  return (
    <ThemeProvider>
      <RepoProvider>
        <ThemedStatusBar />
        <Gate />
      </RepoProvider>
    </ThemeProvider>
  );
}
