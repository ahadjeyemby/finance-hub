import { router } from 'expo-router';

import { ScreenHeader } from '@/components/header';
import { Button, Card, Screen, T } from '@/theme/ui';

export default function Add() {
  return (
    <Screen max={760}>
      <ScreenHeader title="Add" sub="Anything you spent that is not in the ledger yet." />
      <Card title="Statements">
        <T size={13} tone="ink2">Bank and card statements as PDFs or page photos, one or many at once. Each is read, checked against its printed balances, and held until every missing detail is answered.</T>
        <Button label="Import statements" onPress={() => router.push({ pathname: '/import', params: { kind: 'statement' } })} />
      </Card>
      <Card title="Receipts">
        <T size={13} tone="ink2">Photos or PDFs of receipts and orders, one or many at once. Every item, tax and payment detail is kept, and each receipt is linked to its charge when it matches exactly one.</T>
        <Button label="Import receipts" onPress={() => router.push({ pathname: '/import', params: { kind: 'receipt' } })} />
      </Card>
      <Card title="Cash">
        <T size={13} tone="ink2">A short chat for something paid in cash. It keeps asking until the entry is usable, and offers to split a mixed purchase into items.</T>
        <Button kind="outline" label="Add a cash purchase" onPress={() => router.push('/cash')} />
      </Card>
    </Screen>
  );
}
