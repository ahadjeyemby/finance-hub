import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { allCategories } from '@/core/categories';
import { todayISO } from '@/core/dates';
import { likelyCharges } from '@/core/dedupe';
import { dollars } from '@/core/queries';
import { nextCashStep, parseLines } from '@/core/questions';
import type { CashDraft } from '@/core/questions';
import { useRepo } from '@/data/repo';
import { C, F, R, S } from '@/theme/tokens';
import { Banner, Button, Card, Chip, H, Screen, T } from '@/theme/ui';

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function Cash() {
  const { addCash, txns } = useRepo();
  const [draft, setDraft] = useState<CashDraft>({});
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const step = nextCashStep(draft);
  const set = (p: Partial<CashDraft>) => { setDraft({ ...draft, ...p }); setText(''); setErr(''); };
  const today = todayISO();

  const submitText = () => {
    if (!step) return;
    const v = text.trim();
    if (step.kind === 'money') { const n = Number(v.replace(/[$,]/g, '')); if (!(n > 0)) return setErr('Enter an amount above zero, like 12.50'); return set({ amount: Math.round(n * 100) / 100 }); }
    if (step.field === 'lines') {
      const { lines, bad } = parseLines(v);
      if (bad.length) return setErr(`Could not read: ${bad.join(', ')}. Use "item price", separated by commas.`);
      const sum = lines.reduce((s, l) => s + l.amount, 0);
      if (sum > (draft.amount ?? 0) + 0.005) return setErr(`Those add up to ${dollars(Math.round(sum * 100))}, more than the ${dollars(Math.round((draft.amount ?? 0) * 100))} you paid. Check the prices.`);
      return set({ lines, splitAsked: true });
    }
    if (step.kind === 'date') { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return setErr('Use YYYY-MM-DD, or pick Today or Yesterday.'); return set({ date: v || today }); }
    if (!v) return setErr('Type a few words.');
    return set({ [step.field]: v } as Partial<CashDraft>);
  };

  const done = () => { addCash(draft); setSaved(true); };
  // the same purchase may already be in the ledger as a card or bank charge, or as an earlier cash entry
  const clash = step ? [] : likelyCharges({ totalCents: Math.round((draft.amount ?? 0) * 100), date: draft.date, merchant: draft.merchant }, txns);

  if (saved) return (
    <Screen max={640}>
      <ScreenHeader title="Saved" sub={`${dollars(Math.round((draft.amount ?? 0) * 100))} at ${draft.merchant}.`} />
      <Card><T size={13} tone="ink2">It is in your ledger now and counted in the totals.</T>
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}><Button label="Add another" onPress={() => { setDraft({}); setSaved(false); }} /><Button kind="outline" label="Back to Overview" onPress={() => router.replace('/')} /></View></Card>
    </Screen>
  );

  const history: string[] = [];
  if (draft.amount != null) history.push(`Paid ${dollars(Math.round(draft.amount * 100))}`);
  if (draft.merchant) history.push(`To ${draft.merchant}`);
  if (draft.what) history.push(`For ${draft.what}`);
  if (draft.category) history.push(allCategories().find((c) => c.id === draft.category)?.label ?? draft.category);
  if (draft.splitAsked) history.push(draft.lines?.length ? `${draft.lines.length} items` : 'One line');
  if (draft.date) history.push(draft.date);
  if (draft.business !== undefined) history.push(draft.business ? 'Business' : 'Personal');

  return (
    <Screen max={640}>
      <ScreenHeader back title="Cash purchase" sub="Answer a few questions. Nothing is saved until the end." />
      {history.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{history.map((h) => <View key={h} style={{ backgroundColor: C.soft, borderRadius: R.pill, paddingHorizontal: 10, minHeight: 28, justifyContent: 'center' }}><T size={12}>{h}</T></View>)}</View> : null}
      <Card>
        {step ? (
          <>
            <H size={18}>{step.prompt}</H>
            {step.kind === 'category' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {[...allCategories().filter((c) => c.id !== 'uncategorized')].sort((a, b) => (a.id === step.suggestion ? -1 : b.id === step.suggestion ? 1 : 0)).map((c) => <Chip key={c.id} label={c.id === step.suggestion ? `${c.label} (suggested)` : c.label} on={c.id === step.suggestion} onPress={() => set({ category: c.id })} />)}
              </View>
            ) : step.kind === 'yesno' ? (
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Button label="Yes" onPress={() => set({ [step.field]: true } as Partial<CashDraft>)} /><Button kind="outline" label="No" onPress={() => set({ [step.field]: false } as Partial<CashDraft>)} />
              </View>
            ) : (
              <>
                {step.kind === 'date' ? <View style={{ flexDirection: 'row', gap: S.sm }}><Button small label="Today" onPress={() => set({ date: today })} /><Button small kind="outline" label="Yesterday" onPress={() => set({ date: addDays(today, -1) })} /></View> : null}
                <TextInput value={text} onChangeText={setText} onSubmitEditing={submitText} autoFocus returnKeyType="done" accessibilityLabel={step.prompt}
                  keyboardType={step.kind === 'money' ? 'decimal-pad' : 'default'} multiline={step.field === 'lines'}
                  placeholder={step.kind === 'money' ? '0.00' : step.field === 'lines' ? 'tomatoes 4.50, rice 12' : step.kind === 'date' ? 'YYYY-MM-DD' : 'Type here'} placeholderTextColor={C.ink3}
                  style={{ minHeight: 48, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, fontFamily: F.body, fontSize: 16, color: C.ink }} />
                <View style={{ flexDirection: 'row', gap: S.sm }}>
                  <Button label="Next" onPress={submitText} />
                  {step.field === 'lines' ? <Button kind="outline" label="Keep as one line" onPress={() => set({ splitAsked: true })} /> : null}
                </View>
              </>
            )}
            {err ? <T size={13} tone="bad">{err}</T> : null}
          </>
        ) : (
          <>
            <H size={18}>Ready to save</H>
            <T size={14}>{dollars(Math.round((draft.amount ?? 0) * 100))} at {draft.merchant} on {draft.date}.</T>
            {draft.lines?.map((l, i) => <T key={i} size={13} tone="ink2">{l.item}  {dollars(Math.round(l.amount * 100))}</T>)}
            {clash.length ? (
              <>
                <Banner title={clash.length === 1 ? 'This may already be in your ledger' : `${clash.length} charges could be this purchase`}>
                  {clash.slice(0, 3).map((t) => `${t.merchant}, ${t.date}, ${dollars(-t.cents)}, ${t.accountId === 'cash' ? 'an earlier cash entry' : 'a card or bank charge'}`).join('. ')}. Saving it as well would count the purchase twice.
                </Banner>
                <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                  <Button label="It is a separate purchase, save it" onPress={done} />
                  <Button kind="outline" label="Discard" onPress={() => router.replace('/')} />
                </View>
              </>
            ) : <Button label="Save" onPress={done} />}
          </>
        )}
      </Card>
    </Screen>
  );
}
