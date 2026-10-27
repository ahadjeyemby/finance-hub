import { useLocalSearchParams } from 'expo-router';

import { TxnBody } from '@/components/txnview';
import { Screen } from '@/theme/ui';

/** The address /txn/<id>, for links and reloads. Inside the app a transaction opens in the side panel (components/txpanel.tsx). */
export default function TxnDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Screen><TxnBody id={id} /></Screen>;
}
