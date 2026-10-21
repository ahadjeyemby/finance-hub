import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { EvidenceCard } from '@/components/evidence';
import { EditEntry } from '@/components/txnedit';
import { TagsEditor } from '@/components/tags';
import { ScreenHeader } from '@/components/header';
import { allCategories, categoryLabel } from '@/core/categories';
import { dayLabel } from '@/core/dates';
import { CHARGE_NO_LINK, NO_LINK_LABEL } from '@/core/links';
import { dollars } from '@/core/queries';
import type { CategoryId } from '@/core/types';
import { clearFlag, setFlag } from '@/data/links';
import { useRepo } from '@/data/repo';
import { C, F, R, S } from '@/theme/tokens';
import { Button, Card, Chip, Row, Screen, Segmented, T } from '@/theme/ui';

export default function TxnDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { txns, accounts, patchTxn, links, reloadLinks, tagState, saveTagState } = useRepo();
  const [flagging, setFlagging] = useState(false);
  const [linkError, setLinkError] = useState('');
  const t = txns.find((x) => x.id === id);
  const [note, setNote] = useState(t?.note ?? '');
  if (!t) return <Screen><ScreenHeader back title="Not found" sub="This transaction is no longer in the ledger." /></Screen>;
  const acct = accounts.find((a) => a.id === t.accountId);
  const isSpend = t.kind === 'spend' || t.kind === 'fee' || t.kind === 'refund';
  const lineSum = (t.lines ?? []).reduce((s, l) => s + l.cents, 0);
  return (
    <Screen>
      <ScreenHeader back title={t.merchant} sub={`${dayLabel(t.date)}, ${acct?.name ?? t.accountId}`} />
      <Card>
        <T style={{ fontFamily: F.display, fontSize: 32, lineHeight: 38 }}>{dollars(t.cents, { sign: true })}</T>
        <Row label="Counted as" value={t.kind === 'transfer' ? 'Transfer (not spending)' : t.kind} />
        {isSpend ? <Row label="Category" value={categoryLabel(t.category)} /> : null}
        <Row label="Source" value={t.source} />
        <T size={12} tone="ink3">{t.description}</T>
      </Card>
      <EvidenceCard txn={t} />
      <EditEntry key={`${t.id}:${t.merchant}`} txn={t} />
      {isSpend ? (
        <>
          <Card title="Business or personal">
            <Segmented value={t.business ? 'b' : 'p'} onChange={(v) => patchTxn(t.id, { business: v === 'b' })} options={[{ value: 'p', label: 'Personal' }, { value: 'b', label: 'Business' }]} />
          </Card>
          <Card title="Category">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {allCategories().filter((c) => c.id !== 'uncategorized').map((c) => <Chip key={c.id} label={c.label} on={t.category === c.id} onPress={() => patchTxn(t.id, { category: c.id as CategoryId })} />)}
            </View>
          </Card>
          <Card title="Tags">
            <TagsEditor txn={t} tagState={tagState} onChange={saveTagState} />
            <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Manage categories and tags" onPress={() => router.push('/categories')} /></View>
          </Card>
          <Card title="Repeats?">
            <Segmented value={t.oneOff ? 'one' : 'rep'} onChange={(v) => patchTxn(t.id, { oneOff: v === 'one' })} options={[{ value: 'rep', label: 'Normal' }, { value: 'one', label: 'One-time' }]} />
            <T size={12} tone="ink3">One-time expenses show in history but stay out of the forecast.</T>
          </Card>
        </>
      ) : null}
      {t.lines?.length && !isSpend ? (
        <Card title="Items">
          {t.lines.map((l, i) => <Row key={i} label={l.item} value={dollars(l.cents)} />)}
          {lineSum !== -t.cents ? <T size={12} tone="ink3">Items add up to {dollars(lineSum)}.</T> : null}
        </Card>
      ) : null}
      {isSpend && !t.manual && t.kind !== 'refund' ? (
        <Card title="Receipt">
          {t.receiptId ? <T size={13} tone="ink2">A receipt is linked to this charge. Its details are in Evidence above.</T>
            : t.receiptFlag ? <T size={13} tone="ink2">No receipt expected: {NO_LINK_LABEL[t.receiptFlag as keyof typeof NO_LINK_LABEL]?.toLowerCase() ?? t.receiptFlag}.</T>
            : <T size={13} tone="bad" bold>No receipt is linked to this charge.</T>}
          {!t.receiptId && !t.receiptFlag ? <T size={13} tone="ink2">Add the receipt, or say none is expected. Receipts saved before this statement was imported are matched from the Links screen.</T> : null}
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            {!t.receiptId ? <Button small kind="outline" label="Add the receipt" onPress={() => router.push({ pathname: '/import', params: { kind: 'receipt' } })} /> : null}
            <Button small kind="outline" label="Open Links" onPress={() => router.push('/links')} />
            {!t.receiptId && !t.receiptFlag && links ? <Button small kind="outline" label="No receipt expected" onPress={() => setFlagging((f) => !f)} /> : null}
            {t.receiptFlag && links ? <Button small kind="ghost" label="Undo" onPress={() => clearFlag('txn', t.id).then(reloadLinks).catch((e) => setLinkError((e as Error).message))} /> : null}
          </View>
          {flagging ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{CHARGE_NO_LINK.map((r) => <Chip key={r} label={NO_LINK_LABEL[r]} onPress={() => { setFlagging(false); setFlag('txn', t.id, r).then(reloadLinks).catch((e) => setLinkError((e as Error).message)); }} />)}</View> : null}
          {linkError ? <T size={12} tone="bad">{linkError}</T> : null}
        </Card>
      ) : null}
      <Card title="Note">
        <TextInput value={note} onChangeText={setNote} onBlur={() => patchTxn(t.id, { note })} placeholder="Anything worth remembering" placeholderTextColor={C.ink3} multiline accessibilityLabel="Note"
          style={{ minHeight: 64, borderRadius: R.sm, backgroundColor: C.ground, padding: S.md, fontFamily: F.body, fontSize: 14, color: C.ink, textAlignVertical: 'top' }} />
      </Card>
    </Screen>
  );
}
