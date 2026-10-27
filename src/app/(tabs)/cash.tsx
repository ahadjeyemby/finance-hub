import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { allCategories, categoryLabel } from '@/core/categories';
import { CASH_TABS, buildCash, cashChanged, checkCash, emptyCashForm, firstOpenTab, suggestedCategory, tabStatus, txnToForm } from '@/core/cashform';
import type { CashForm, CashTab } from '@/core/cashform';
import { dayLabel, todayISO } from '@/core/dates';
import { likelyCharges } from '@/core/dedupe';
import { parseDateISO } from '@/core/intake';
import { dollars } from '@/core/queries';
import { useRepo } from '@/data/repo';
import { R, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Card, Chip, Row, Screen, Segmented, T, useInputStyle } from '@/theme/ui';

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const STATUS_TEXT = { done: 'Done', todo: 'To do', error: 'Check', optional: 'Optional' } as const;

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <View style={{ gap: 4 }}><T size={13} bold>{label}</T>{children}{error ? <T size={12} tone="bad">{error}</T> : null}</View>;
}

/**
 * A cash purchase as a form in sections: Amount, Details, Items, Review. Any section can be opened at any time, Back and Next walk through them,
 * and the tabs say which are done. The same screen changes an entry saved earlier (open it from the transaction, or with ?id=).
 */
export default function Cash() {
  const C = useColors();
  const input = { ...useInputStyle(), minHeight: 48, fontSize: 16 };
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { txns, addCash, updateCash, removeCash, auth } = useRepo();
  const today = todayISO();
  const existing = useMemo(() => (id ? txns.find((t) => t.id === id && t.manual && (!t.owner || t.owner === auth.userId)) : undefined), [id, txns, auth.userId]);
  const initial = useMemo(() => (existing ? txnToForm(existing) : emptyCashForm(today)), [existing, today]);
  const [form, setForm] = useState<CashForm>(initial);
  const [tab, setTab] = useState<CashTab>(existing ? 'review' : 'amount');
  const [saved, setSaved] = useState<{ cents: number; merchant: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (p: Partial<CashForm>) => setForm((f) => ({ ...f, ...p }));

  const check = useMemo(() => checkCash(form), [form]);
  const status = useMemo(() => tabStatus(form), [form]);
  const suggestion = suggestedCategory(form);
  const index = CASH_TABS.findIndex((t) => t.id === tab);
  const editing = !!existing;
  const changed = editing && cashChanged(initial, form);
  // the same purchase may already be in the ledger as a card or bank charge, or as an earlier cash entry (not itself)
  const clash = useMemo(() => (check.ok ? likelyCharges({ totalCents: Math.round(Number(form.amount) * 100), date: parseDateISO(form.date), merchant: form.merchant }, txns.filter((t) => t.id !== existing?.id)) : []), [check.ok, form.amount, form.date, form.merchant, txns, existing?.id]);
  const [overrideClash, setOverrideClash] = useState(false);

  if (id && !existing) {
    return <Screen max={640}><ScreenHeader back title="Cash entry" sub="This entry is no longer here, or it is not one you entered." /></Screen>;
  }

  const save = () => {
    if (!check.ok) return;
    if (existing) { const t = buildCash(form, today, Date.now(), existing); updateCash(t); router.replace({ pathname: '/txn/[id]', params: { id: t.id } }); return; }
    const t = buildCash(form, today);
    addCash({ amount: Math.abs(t.cents) / 100, merchant: t.merchant, what: form.what.trim() || undefined, category: form.category, date: t.date, business: form.business, oneOff: form.oneOff, lines: check.lines.length ? check.lines : undefined, splitAsked: true });
    setSaved({ cents: Math.abs(t.cents), merchant: t.merchant });
  };

  if (saved) return (
    <Screen max={640}>
      <ScreenHeader title="Saved" sub={`${dollars(saved.cents)} at ${saved.merchant}.`} />
      <Card><T size={13} tone="ink2">It is in your ledger now and counted in the totals. You can change it later from the transaction.</T>
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          <Button label="Add another" onPress={() => { setForm(emptyCashForm(today)); setTab('amount'); setSaved(null); setOverrideClash(false); }} />
          <Button kind="outline" label="Back to Overview" onPress={() => router.replace('/')} />
        </View></Card>
    </Screen>
  );

  const categories = [...allCategories().filter((c) => c.id !== 'uncategorized')].sort((a, b) => (a.id === suggestion ? -1 : b.id === suggestion ? 1 : 0));
  const itemsTotal = Math.round(check.lines.reduce((s, l) => s + l.amount, 0) * 100);

  return (
    <Screen max={640}>
      <ScreenHeader back title={editing ? 'Edit cash entry' : 'Cash purchase'} sub={editing ? `${existing!.merchant}, ${dayLabel(existing!.date)}. Change anything, then save.` : 'Fill in the sections in any order. Nothing is saved until you press Save.'} />

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 6 }}>
        {CASH_TABS.map((t, i) => {
          const on = t.id === tab; const st = status[t.id];
          return (
            <Pressable key={t.id} accessibilityRole="tab" aria-selected={on} accessibilityLabel={`${t.label}, ${STATUS_TEXT[st]}`} onPress={() => setTab(t.id)}
              style={{ flex: 1, minHeight: 52, borderRadius: R.md, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.accent : C.soft, borderWidth: st === 'error' ? 2 : 0, borderColor: C.bad }}>
              <T size={13} bold tone={on ? 'paper' : 'ink'}>{i + 1}. {t.label}</T>
              <T size={11} tone={on ? 'paper' : st === 'error' ? 'bad' : st === 'done' ? 'good' : 'ink3'}>{STATUS_TEXT[st]}</T>
            </Pressable>
          );
        })}
      </View>
      <T size={12} tone="ink3">{CASH_TABS[index].help}</T>

      <Card>
        {tab === 'amount' ? (
          <>
            <Field label="Amount paid" error={form.amount && check.errors.amount ? check.errors.amount : undefined}>
              <TextInput value={form.amount} onChangeText={(v) => set({ amount: v })} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={C.ink3} accessibilityLabel="Amount paid" autoFocus={!editing} style={input} />
            </Field>
            <Field label="Paid to" error={form.merchant === '' ? undefined : check.errors.merchant}>
              <TextInput value={form.merchant} onChangeText={(v) => set({ merchant: v })} placeholder="A store, a person, a service" placeholderTextColor={C.ink3} accessibilityLabel="Paid to" style={input} />
            </Field>
            <Field label="Date" error={check.errors.date}>
              <TextInput value={form.date} onChangeText={(v) => set({ date: v })} placeholder="YYYY-MM-DD" placeholderTextColor={C.ink3} accessibilityLabel="Date" style={input} />
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Button small kind={form.date === today ? 'solid' : 'outline'} label="Today" onPress={() => set({ date: today })} />
                <Button small kind={form.date === addDays(today, -1) ? 'solid' : 'outline'} label="Yesterday" onPress={() => set({ date: addDays(today, -1) })} />
              </View>
            </Field>
          </>
        ) : null}

        {tab === 'details' ? (
          <>
            <Field label="What was it for? (optional)">
              <TextInput value={form.what} onChangeText={(v) => set({ what: v })} placeholder="A few words, for example vegetables and rice" placeholderTextColor={C.ink3} accessibilityLabel="What it was for" style={input} />
            </Field>
            <Field label="Category" error={check.errors.category}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {categories.map((c) => <Chip key={c.id} label={c.id === suggestion ? `${c.label} (suggested)` : c.label} on={form.category === c.id} onPress={() => set({ category: c.id })} />)}
              </View>
            </Field>
            <Field label="Business or personal">
              <Segmented value={form.business ? 'b' : 'p'} onChange={(v) => set({ business: v === 'b' })} options={[{ value: 'p', label: 'Personal' }, { value: 'b', label: 'Business' }]} />
            </Field>
            <Field label="Does this repeat?">
              <Segmented value={form.oneOff ? 'one' : 'rep'} onChange={(v) => set({ oneOff: v === 'one' })} options={[{ value: 'rep', label: 'Normal' }, { value: 'one', label: 'One-time' }]} />
              <T size={12} tone="ink3">One-time expenses show in history but stay out of the forecast.</T>
            </Field>
          </>
        ) : null}

        {tab === 'items' ? (
          <>
            <Field label="Items, one per line as “item price”" error={check.errors.items}>
              <TextInput value={form.items} onChangeText={(v) => set({ items: v })} multiline placeholder={'tomatoes 4.50\nrice 12'} placeholderTextColor={C.ink3} accessibilityLabel="Items" style={[input, { minHeight: 120, paddingTop: S.sm, textAlignVertical: 'top' }]} />
            </Field>
            {form.items.trim() && !check.errors.items ? <T size={13} tone="ink2">{check.lines.length} item{check.lines.length === 1 ? '' : 's'}, {dollars(itemsTotal)}{check.remainderCents ? `. The other ${dollars(check.remainderCents)} is saved as “Other (not itemised)”.` : '. This is the whole amount.'}</T> : <T size={12} tone="ink3">Leave empty to keep it as one line. Items let tags and categories count what was actually bought.</T>}
            {form.items.trim() ? <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Clear the items" onPress={() => set({ items: '' })} /></View> : null}
          </>
        ) : null}

        {tab === 'review' ? (
          <>
            <Row label="Amount" value={check.errors.amount ? 'Needed' : dollars(Math.round(Number(form.amount) * 100))} tone={check.errors.amount ? 'bad' : undefined} />
            <Row label="Paid to" value={form.merchant.trim() || 'Needed'} tone={check.errors.merchant ? 'bad' : undefined} />
            <Row label="Date" value={check.errors.date ? 'Check the date' : dayLabel(parseDateISO(form.date)!)} tone={check.errors.date ? 'bad' : undefined} />
            <Row label="Category" value={form.category ? categoryLabel(form.category) : 'Needed'} tone={check.errors.category ? 'bad' : undefined} />
            <Row label="Counted as" value={`${form.business ? 'Business' : 'Personal'}, ${form.oneOff ? 'one-time' : 'normal'}`} />
            {form.what.trim() ? <Row label="For" value={form.what.trim()} /> : null}
            {check.lines.map((l, i) => <Row key={i} label={l.item} value={dollars(Math.round(l.amount * 100))} />)}
            {check.remainderCents ? <Row label="Other (not itemised)" value={dollars(check.remainderCents)} /> : null}
            {!check.ok ? (
              <View style={{ gap: 4 }}>
                {(Object.entries(check.errors) as [keyof typeof check.errors, string][]).map(([field, msg]) => (
                  <Pressable key={field} accessibilityRole="button" onPress={() => setTab(field === 'category' ? 'details' : field === 'items' ? 'items' : 'amount')}><T size={13} tone="bad">{msg} Tap to fix.</T></Pressable>
                ))}
              </View>
            ) : null}
            {check.ok && clash.length ? (
              <Banner title={clash.length === 1 ? 'This may already be in your ledger' : `${clash.length} charges could be this purchase`}>
                {clash.slice(0, 3).map((t) => `${t.merchant}, ${t.date}, ${dollars(-t.cents)}, ${t.accountId === 'cash' ? 'an earlier cash entry' : 'a card or bank charge'}`).join('. ')}. Saving it as well would count the purchase twice.
              </Banner>
            ) : null}
            {check.ok && clash.length && !overrideClash ? <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="It is a separate purchase" onPress={() => setOverrideClash(true)} /></View> : null}
            {editing ? (
              <View style={{ gap: S.xs, borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.sm }}>
                {confirmRemove ? (
                  <>
                    <T size={13} tone="bad">Remove this cash entry from your ledger? It stops counting in the totals. This cannot be undone.</T>
                    <View style={{ flexDirection: 'row', gap: S.sm }}>
                      <Button small kind="outline" label="Yes, remove it" onPress={() => { removeCash(existing!.id); router.replace('/'); }} />
                      <Button small kind="ghost" label="Keep it" onPress={() => setConfirmRemove(false)} />
                    </View>
                  </>
                ) : <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Remove this entry" onPress={() => setConfirmRemove(true)} /></View>}
              </View>
            ) : null}
          </>
        ) : null}
      </Card>

      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button kind="outline" label="Back" disabled={index === 0} onPress={() => setTab(CASH_TABS[index - 1].id)} />
        {index < CASH_TABS.length - 1 ? <Button kind="outline" label="Next" onPress={() => setTab(CASH_TABS[index + 1].id)} /> : null}
        <Button label={editing ? 'Save changes' : 'Save'} disabled={!check.ok || (editing && !changed) || (clash.length > 0 && !overrideClash)} onPress={save} />
        {!check.ok ? <Pressable accessibilityRole="button" onPress={() => setTab(firstOpenTab(form))}><T size={12} tone="ink3">Next thing to fill in: {CASH_TABS.find((t) => t.id === firstOpenTab(form))!.label}</T></Pressable> : editing && !changed ? <T size={12} tone="ink3">No changes yet.</T> : null}
      </View>
    </Screen>
  );
}
