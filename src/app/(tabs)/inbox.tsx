import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { dayLabel } from '@/core/dates';
import { dollars } from '@/core/queries';
import type { Question } from '@/core/types';
import { useRepo } from '@/data/repo';
import { F, R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Card, H, Screen, T } from '@/theme/ui';

const LABEL: Record<string, string> = {
  confirm_income: 'Deposit', transfer_account: 'Transfer', person_payment: 'Payment to a person', category: 'Category',
  business_or_personal: 'Business or personal', one_off: 'One-time or repeating', items: 'Item detail',
};

function QuestionCard({ q, onDone }: { q: Question; onDone: (q: Question) => void }) {
  const C = useColors();
  const { answer, txns, accounts } = useRepo();
  const [all, setAll] = useState(true);
  const [see, setSee] = useState(false);
  const rows = q.txnIds.map((id) => txns.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
        <T size={12} bold tone="ink3">{LABEL[q.type] ?? 'Question'}</T>
        <T size={12} bold>{dollars(q.cents, { decimals: false })} at stake</T>
      </View>
      <H size={16}>{q.prompt}</H>
      <T size={13} tone="ink2">{q.detail}</T>
      {rows.length ? <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label={see ? 'Hide the details' : rows.length > 1 ? `See the ${rows.length} transactions` : 'See the transaction'} onPress={() => setSee((v) => !v)} /></View> : null}
      {see ? (
        <View style={{ gap: S.sm, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
          {rows.slice(0, 6).map((t) => {
            const a = accounts.find((x) => x.id === t.accountId);
            return (
              <View key={t.id} style={{ gap: 2, borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: S.sm }}>
                <T size={14} bold>{t.merchant}: {dollars(t.cents, { sign: true })}</T>
                <T size={13} tone="ink2">{dayLabel(t.date)}, {a ? `${a.name}${a.last4 ? ` (${a.institution} ${a.last4})` : ''}` : t.accountId}</T>
                <T size={13} tone="ink2">As the bank printed it: {t.description || 'no description'}</T>
                {t.source ? <T size={12} tone="ink3">From: {t.source}{t.ref ? `, reference ${t.ref}` : ''}</T> : null}
                <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="Open details and statement line" onPress={() => router.push({ pathname: '/txn/[id]', params: { id: t.id } })} /></View>
              </View>
            );
          })}
          {rows.length > 6 ? <View style={{ gap: S.xs }}><T size={12} tone="ink3">{rows.length - 6} more not shown.</T><View style={{ flexDirection: 'row' }}><Button small kind="outline" label={`All ${q.merchant} transactions`} onPress={() => router.push({ pathname: '/ledger', params: { merchant: q.merchant } })} /></View></View> : null}
        </View>
      ) : null}
      {q.canApplyToMerchant ? (
        <Pressable accessibilityRole="checkbox" aria-checked={all} onPress={() => setAll(!all)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: C.accent, backgroundColor: all ? C.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{all ? <T size={13} tone="paper" bold>{'✓'}</T> : null}</View>
          <T size={13}>Use this answer for every {q.merchant} charge, including future ones</T>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {q.choices.length > 8
          ? q.choices.map((c) => <Button key={c.value} small kind="outline" label={c.label} onPress={() => { const r = answer(q, c.value, all); onDone(q); if (r.goto === 'add') router.push('/add'); }} />)
          : q.choices.map((c, i) => <Button key={c.value} kind={i === 0 ? 'solid' : 'outline'} label={c.label} onPress={() => { const r = answer(q, c.value, all); onDone(q); if (r.goto === 'add') router.push('/add'); }} />)}
      </View>
    </Card>
  );
}

export default function Inbox() {
  const C = useColors();
  const { questions, undo, txns } = useRepo();
  const [last, setLast] = useState<Question | null>(null);
  const [shown, setShown] = useState(8);
  const stake = questions.reduce((s, q) => s + q.cents, 0);
  const biz = txns.filter((t) => t.business && !t.manual && t.kind === 'spend');
  return (
    <Screen max={760}>
      <ScreenHeader title="Inbox" sub={questions.length ? `${questions.length} questions, ${dollars(stake, { decimals: false })} at stake. Biggest first.` : 'Nothing is waiting.'} />
      {last ? (
        <View style={{ backgroundColor: C.accent, borderRadius: R.md, padding: S.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
          <T size={13} style={{ flex: 1, color: C.onAccent }}>Saved: {last.merchant}</T>
          <Button small kind="onAccent" label="Undo" onPress={() => { undo(last); setLast(null); }} />
        </View>
      ) : null}
      {biz.length ? <Banner tone="info" title="Developer tools are filed as business.">{biz.length} charges ({dollars(biz.reduce((s, t) => s - t.cents, 0))}) from GitHub, Heroku, Namecheap and similar were filed as business automatically. They stay out of household totals and the forecast. Change any of them from its transaction page.</Banner> : null}
      {questions.slice(0, shown).map((q) => <QuestionCard key={q.id} q={q} onDone={setLast} />)}
      {questions.length > shown ? <Button kind="outline" label={`Show ${Math.min(8, questions.length - shown)} more`} onPress={() => setShown(shown + 8)} /> : null}
      {!questions.length ? <Card><T tone="ink2">All caught up. New cash entries and receipts add questions here only when something is unclear.</T></Card> : null}
    </Screen>
  );
}
export { F };
