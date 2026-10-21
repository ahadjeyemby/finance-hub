import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { FieldInput } from '@/components/intake';
import { todayISO } from '@/core/dates';
import type { ReceiptRecord } from '@/core/evidence';
import { RECEIPT_FIELDS, analyseReceipt, noAnswers, receiptFieldText, setReceiptField } from '@/core/intake';
import type { Answers } from '@/core/intake';
import { useRepo } from '@/data/repo';
import { updateReceiptRecord } from '@/data/intake';
import { S } from '@/theme/tokens';
import { Banner, Button, Card, Screen, T } from '@/theme/ui';

/**
 * Change a receipt that is already stored: its store, date, amounts, payment details and items. It is checked the way a new receipt is checked,
 * and saved only when it adds up or each disagreement is confirmed as printed. Nothing is adjusted for the person.
 */
export default function ReceiptEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { links, team, sync } = useRepo();
  const stored = useMemo(() => links?.receipts.find((r) => r.id === id) ?? null, [links, id]);
  const [rec, setRec] = useState<ReceiptRecord | null>(stored);
  const [answers, setAnswers] = useState<Answers>(noAnswers());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!stored || !rec) return <Screen max={720}><ScreenHeader back title="Receipt" sub="This receipt is not available. It may have been removed, or the links have not loaded yet." /></Screen>;

  // a member's receipt (seen by their admin) is saved under that member
  const owner = team.members.find((m) => team.dataOf(m.member)?.links?.receipts.some((r) => r.id === stored.id))?.member;
  const analysis = analyseReceipt(rec, answers, todayISO());
  const needed = analysis.gaps.filter((g) => !g.canSkip);
  const changed = JSON.stringify(rec) !== JSON.stringify(stored);
  const canSave = changed && needed.length === 0 && analysis.problems.length === 0 && !busy;

  const edit = (field: string, text: string) => {
    const r = setReceiptField(rec, field, text);
    if (r.error) return setErrors((e) => ({ ...e, [field]: r.error! }));
    setErrors((e) => { const { [field]: _gone, ...rest } = e; return rest; });
    // earlier "keep as printed" answers were about the old numbers
    setRec(r.record); setAnswers((a) => ({ ...a, acknowledged: [] })); setError('');
  };
  const save = async () => {
    setBusy(true); setError('');
    try { await updateReceiptRecord(stored.id, rec, owner); await sync.now(); router.back(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <Screen max={720}>
      <ScreenHeader back title="Edit receipt" sub={`${stored.merchant ?? 'Receipt'}${stored.date ? `, ${stored.date}` : ''}. Change anything that was read wrongly.`} />
      <Card title="Details">
        {RECEIPT_FIELDS.map(([f, label]) => <FieldInput key={`${f}:${receiptFieldText(rec, f)}`} label={label} value={receiptFieldText(rec, f)} error={errors[f]} onCommit={(t) => edit(f, t)} />)}
        <FieldInput key={`lines:${receiptFieldText(rec, 'lines')}`} label="Items, one per line as “item price” (a discount is “name -2.50”)" multiline value={receiptFieldText(rec, 'lines')} error={errors.lines} onCommit={(t) => edit('lines', t)} />
      </Card>

      {needed.length ? <Banner title="Still needed">{needed.map((g) => g.label).join(', ')}.</Banner> : null}
      {analysis.problems.map((p) => (
        <Banner key={p.id} title="Check this">
          <T size={13} tone="ink2">{p.text}</T>
          <View style={{ flexDirection: 'row', marginTop: 4 }}><Button small kind="outline" label={p.confirm ?? 'Keep as printed'} onPress={() => setAnswers((a) => ({ ...a, acknowledged: [...a.acknowledged, p.id] }))} /></View>
        </Banner>
      ))}
      {analysis.notes.map((n) => <T key={n} size={12} tone="ink3">{n}</T>)}
      {changed && !needed.length && !analysis.problems.length ? <T size={13} tone="good">It adds up. The link to its charge stays as it is: open Links if the amount changed.</T> : null}
      {error ? <T size={13} tone="bad">{error}</T> : null}
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Button label={busy ? 'Saving' : 'Save changes'} disabled={!canSave} onPress={save} />
        <Button kind="outline" label="Cancel" disabled={busy} onPress={() => router.back()} />
      </View>
      {!changed ? <T size={12} tone="ink3">No changes yet.</T> : null}
    </Screen>
  );
}
