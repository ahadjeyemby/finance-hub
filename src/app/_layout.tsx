import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_700Bold, useFonts } from '@expo-google-fonts/hanken-grotesk';
import { Slot, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { NoData } from '@/components/nodata';
import { SignIn } from '@/components/signin';
import { SavedCopyNote } from '@/components/source';
import { ViewSwitch } from '@/components/viewswitch';
import { RepoProvider, useRepo } from '@/data/repo';
import { C } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const { ready, auth, hasData } = useRepo();
  const pathname = usePathname();
  const [fonts, fontError] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_700Bold });
  useEffect(() => { if (ready && (fonts || fontError)) SplashScreen.hideAsync().catch(() => {}); }, [ready, fonts, fontError]);
  if (!ready || (!fonts && !fontError)) return <View style={{ flex: 1, backgroundColor: C.ground }} />;
  // with a backend configured, nothing is shown until someone signs in
  if (auth.configured && !auth.email) return <SignIn />;
  // no ledger in the database: say so, never show anything else. The import screen is the one way out of an empty database, and the People
  // screen is where an invited person joins a workspace (they have no data of their own yet).
  if (!hasData && pathname !== '/import' && pathname !== '/people') return <NoData />;
  return <View style={{ flex: 1, backgroundColor: C.ground }}><SavedCopyNote /><ViewSwitch /><Slot /></View>;
}

export default function Root() {
  return (
    <RepoProvider>
      <StatusBar style="dark" />
      <Gate />
    </RepoProvider>
  );
}
