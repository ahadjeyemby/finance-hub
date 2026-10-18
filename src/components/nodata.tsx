import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { useRepo } from '@/data/repo';
import { C, F, R, S } from '@/theme/tokens';
import { Button, H, T } from '@/theme/ui';

/** What the person sees whenever the database has no ledger for them. The app never substitutes bundled or sample data. */
export function NoData() {
  const { auth, sync } = useRepo();
  const missingTables = !!sync.error && /schema cache|does not exist|relation .* does not exist/i.test(sync.error);
  const loading = auth.configured && !!auth.email && (sync.state === 'syncing' || sync.state === 'local');

  let title = 'Data is not available';
  let body = 'Your database has no accounts or transactions yet. Import a statement here, or load your ledger from your computer and tap Check again.';
  let hint = 'bun run ledger:upload';
  if (!auth.configured) {
    title = 'No database connected';
    body = 'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, then restart the app.';
    hint = '';
  } else if (loading) {
    title = 'Loading your data';
    body = 'Fetching your ledger from the database.';
    hint = '';
  } else if (sync.state === 'error') {
    title = 'Could not load your data';
    body = missingTables ? 'The database tables are missing. Apply the migration, then load your ledger.' : (sync.error ?? 'The database did not answer.');
    hint = missingTables ? 'supabase db push' : '';
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: S.lg }}>
      <View style={{ width: '100%', maxWidth: 440, gap: S.lg }}>
        <View style={{ gap: 4 }}>
          <H size={26}>{title}</H>
          <T tone="ink2">{body}</T>
        </View>
        {hint ? (
          <View style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md }}>
            <Text selectable style={{ fontFamily: F.bodyMed, fontSize: 14, color: C.ink }}>{hint}</Text>
          </View>
        ) : null}
        {auth.configured && auth.email ? (
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            {!missingTables && sync.state !== 'error' ? <Button label="Import a statement" disabled={loading} onPress={() => router.push('/import')} /> : null}
            <Button kind={!missingTables && sync.state !== 'error' ? 'outline' : 'solid'} label="Check again" disabled={loading} onPress={() => { sync.now(); }} />
            <Button kind="outline" label="Sign out" onPress={() => { auth.signOut(); }} />
          </View>
        ) : null}
        {auth.email ? <T size={12} tone="ink3">Signed in as {auth.email}.</T> : null}
      </View>
    </View>
  );
}
