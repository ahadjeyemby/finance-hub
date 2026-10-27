import { useLocalSearchParams } from 'expo-router';

import { LedgerBody } from '@/components/ledgerview';
import { Screen } from '@/theme/ui';

/** The address /ledger, for links and reloads. Inside the app the transactions open in the side panel (components/txpanel.tsx). */
export default function Ledger() {
  const p = useLocalSearchParams<{ from?: string; to?: string; category?: string; merchant?: string; kinds?: string; tags?: string; group?: string }>();
  return <Screen><LedgerBody params={p} /></Screen>;
}
