import { View } from 'react-native';

import { useRepo } from '@/data/repo';
import { S } from '@/theme/tokens';
import { Banner } from '@/theme/ui';

export const sourceWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'earlier');

/**
 * Every number in the app comes from Supabase. The one time that is not literally true is when Supabase cannot be reached and the
 * app shows the copy it downloaded earlier from the same project for the same person. That case is never silent.
 */
export function SavedCopyNote() {
  const { source, sync } = useRepo();
  if (source.kind !== 'saved' || sync.state !== 'error') return null;
  return (
    <View style={{ padding: S.md }}>
      <Banner title="Supabase did not answer. You are looking at a saved copy.">
        Downloaded from your Supabase project {source.project ?? ''} on {sourceWhen(source.at)}. Newer rows, if any, will appear once the connection works. Open Accounts and data, then Sync now, to try again.
      </Banner>
    </View>
  );
}
