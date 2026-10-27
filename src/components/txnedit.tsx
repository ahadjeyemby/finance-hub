import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { parseLines } from '@/core/questions';
import { dollars } from '@/core/queries';
import type { Txn } from '@/core/types';
import { useRepo } from '@/data/repo';
import { S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Button, Card, T, useInputStyle } from '@/theme/ui';

const REST = 'Other (not itemised)';

/**
 * Change an entry. A cash entry opens in the same form it was made in. A row from a statement keeps its printed date and amount (they are what
 * the bank said), but its name and its items can be changed, and each change can be taken back.
 */
export function EditEntry({ txn }: { txn: Txn }) {
  const C = useColors();
  const input = useInputStyle();
  const { overlay, patchTxn, clearPatch, auth } = useRepo();
  const mine = !txn.owner || txn.owner === auth.userId;
  const patch = overlay.patches[txn.id];
  const renamed = patch?.merchant != null;
  const [name, setName] = useState(txn.merchant);
  const [itemsText, setItemsText] = useState((txn.lines ?? []).filter((l) => l.item !== REST).map((l) => `${l.item} ${(l.cents / 100).toFixed(2)}`).join('\n'));
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const spendLike = txn.kind === 'spend' || txn.kind === 'fee' || txn.kind === 'refund';
  const total = Math.abs(txn.cents);

  if (txn.manual) {
    if (!mine) return null;
    return (
      <Card title="Edit this entry">
        <T size={13} tone="ink2">You entered this one, so everything about it can be changed: the amount, who was paid, the date, the category and the items.</T>
        <View style={{ flexDirection: 'row' }}><Button label="Edit this cash entry" onPress={() => router.push({ pathname: '/cash', params: { id: txn.id } })} /></View>
      </Card>
    );
  }

  const saveName = () => {
    const v = name.trim();
    if (!v) return setErr('The name cannot be empty.');
    setErr(''); setDone('Name saved.');
    if (v === txn.merchant) return;
    patchTxn(txn.id, { merchant: v });
  };
  const saveItems = () => {
    setDone('');
    if (!itemsText.trim()) { clearPatch(txn.id, ['lines']); setErr(''); return setDone('Items removed. It shows as one line again.'); }
    const p = parseLines(itemsText);
    if (p.bad.length) return setErr(`Could not read: ${p.bad.join(', ')}. Use "item price", one per line.`);
    const sum = Math.round(p.lines.reduce((s, l) => s + l.amount, 0) * 100);
    if (sum > total) return setErr(`The items add up to ${dollars(sum)}, more than this charge of ${dollars(total)}. Check the prices.`);
    const lines = p.lines.map((l) => ({ item: l.item, cents: Math.round(l.amount * 100) }));
    if (sum < total) lines.push({ item: REST, cents: total - sum });
    setErr(''); patchTxn(txn.id, { lines }); setDone(sum < total ? `Items saved. The other ${dollars(total - sum)} is kept as “${REST}”.` : 'Items saved.');
  };

  return (
    <Card title="Edit details">
      <T size={12} tone="ink3">The date and amount come from the statement and are not changed here. If the statement was read wrongly, import it again.</T>
      <View style={{ gap: 4 }}>
        <T size={13} bold>Name</T>
        <TextInput value={name} onChangeText={(v) => { setName(v); setDone(''); }} placeholder="Name" placeholderTextColor={C.ink3} accessibilityLabel="Name" style={input} />
        <T size={12} tone="ink3">The bank wrote: {txn.description}</T>
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          <Button small kind="outline" label="Save name" disabled={name.trim() === txn.merchant} onPress={saveName} />
          {renamed ? <Button small kind="ghost" label="Use the bank's name again" onPress={() => { clearPatch(txn.id, ['merchant']); setDone('Back to the name from the statement.'); }} /> : null}
        </View>
      </View>
      {spendLike && !txn.receiptId ? (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
          <T size={13} bold>Items, one per line as “item price”</T>
          <TextInput value={itemsText} onChangeText={(v) => { setItemsText(v); setDone(''); setErr(''); }} multiline placeholder={'milk 3.50\nbread 2.25'} placeholderTextColor={C.ink3} accessibilityLabel="Items" style={[input, { minHeight: 96, paddingTop: S.sm, textAlignVertical: 'top' }]} />
          <T size={12} tone="ink3">Split this charge into what was bought, so categories and tags count the items. Anything left over is kept as one more line.</T>
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            <Button small kind="outline" label="Save items" onPress={saveItems} />
            {patch?.lines ? <Button small kind="ghost" label="Remove my items" onPress={() => { clearPatch(txn.id, ['lines']); setItemsText(''); setDone('Items removed.'); }} /> : null}
          </View>
        </View>
      ) : spendLike && txn.receiptId ? <T size={12} tone="ink3">The items come from the linked receipt. Change them by editing the receipt, under Evidence above.</T> : null}
      {err ? <T size={13} tone="bad">{err}</T> : null}
      {done ? <T size={13} tone="good">{done}</T> : null}
    </Card>
  );
}
