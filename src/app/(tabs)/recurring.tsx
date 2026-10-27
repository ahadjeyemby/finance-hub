import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { dayLabel, monthLabel, todayISO } from '@/core/dates';
import { dollars } from '@/core/queries';
import { CADENCE_LABEL, addManual, decide, incomeVsFixed, removeManual, summarizeRecurring } from '@/core/recurring';
import type { Cadence, RecurringItem } from '@/core/recurring';
import { useRepo } from '@/data/repo';
import { S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Banner, Button, Card, Chip, Screen, T, useInputStyle } from '@/theme/ui';

const CADENCES = Object.keys(CADENCE_LABEL) as Cadence[];

/**
 * Everything that comes round on a rhythm, with the one number to plan around: what has to be there each month. Found from the statements,
 * confirmed or set aside by the person, and topped up by hand for what no statement shows (rent paid in cash).
 */
export default function Recurring() {
  const C = useColors();
  const input = useInputStyle();
  const { txns, ctx, dataTo, recurring, saveRecurring, spendingOnly } = useRepo();
  const today = todayISO();
  // business-marked charges are excluded from personal totals everywhere else, so they are here too
  const sum = useMemo(() => summarizeRecurring(txns.filter((t) => !t.business), recurring, dataTo, today), [txns, recurring, dataTo, today]);
  const cover = useMemo(() => incomeVsFixed(ctx, sum.fixedMonthlyCents, dataTo), [ctx, sum.fixedMonthlyCents, dataTo]);
  const [asideOpen, setAsideOpen] = useState(false);
  const [name, setName] = useState(''); const [amount, setAmount] = useState(''); const [cadence, setCadence] = useState<Cadence>('monthly'); const [anchor, setAnchor] = useState(today);

  const on = sum.items.filter((i) => i.status === 'on');
  const aside = sum.items.filter((i) => i.status !== 'on');
  const alerts = on.filter((i) => i.change || i.health !== 'active');
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, '')) * 100);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(anchor) && !Number.isNaN(Date.parse(anchor));
  const canAdd = name.trim().length > 0 && Number.isFinite(cents) && cents > 0 && validDate;
  const upcomingTotal = sum.upcoming.reduce((s, u) => s + u.cents, 0);

  return (
    <Screen max={820}>
      <ScreenHeader back title="Recurring" sub="Charges that come round on a rhythm, and what you need each month to cover them." />

      <Card title="Fixed each month">
        <T size={32} bold>{dollars(sum.fixedMonthlyCents)}</T>
        <T size={13} tone="ink2">Yearly and quarterly charges are spread across the months, so a $120 yearly fee counts as $10. Items switched off, cancelled or no longer charging are left out.</T>
        <T size={12} tone="ink3">{dollars(sum.fixedMonthlyCents * 12)} a year across {on.filter((i) => i.health !== 'stopped').length} item{on.filter((i) => i.health !== 'stopped').length === 1 ? '' : 's'}. {sum.unconfirmedMonthlyCents > 0 ? `${dollars(sum.unconfirmedMonthlyCents)} of it is found from your statements and not yet confirmed by you.` : 'Everything in it is confirmed or added by you.'}</T>
        <T size={12} tone="ink3">Based on statements up to {dataTo > '0000' ? dayLabel(dataTo) : 'none yet'}. A variable bill such as electricity is planned at its middle amount, so the real month can be higher or lower.</T>
      </Card>

      {spendingOnly ? null : (
      <Card title="Against your income">
        {cover ? (
          <>
            <T size={14}>{cover.incomeCents > 0 ? `Income averages ${dollars(cover.incomeCents)} a month over ${cover.months.length === 1 ? 'the last complete month' : `the last ${cover.months.length} complete months`}. Fixed costs take ${cover.share != null ? `${(cover.share * 100).toFixed(0)}%` : ''} of it.` : 'No confirmed income found in the complete months, so there is nothing to compare with.'}</T>
            {cover.incomeCents > 0 ? <T size={22} bold tone={cover.leftCents < 0 ? 'bad' : 'ink'}>{cover.leftCents < 0 ? `${dollars(-cover.leftCents)} short each month` : `${dollars(cover.leftCents)} left each month`}</T> : null}
            {cover.incomeCents > 0 ? <View style={{ height: 8, backgroundColor: C.line, borderRadius: 4, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, Math.max(2, (cover.share ?? 0) * 100))}%`, height: '100%', backgroundColor: cover.leftCents < 0 ? C.bad : C.bar, borderRadius: 4 }} /></View> : null}
            <T size={12} tone="ink3">Months used: {cover.months.map((m) => monthLabel(m, true)).join(', ')}. What is left is before everyday spending such as groceries and fuel.{cover.unconfirmedCents > 0 ? ` ${dollars(cover.unconfirmedCents)} a month of income is still unconfirmed and not counted.` : ''}{cover.incomeIncomplete ? ' A checking account is marked as not showing all income, so the average may be low.' : ''}</T>
          </>
        ) : <T size={13} tone="ink2">No month is fully covered by every account&apos;s statements yet, so income cannot be averaged.</T>}
      </Card>
      )}

      {alerts.length ? (
        <Banner title={`${alerts.length} thing${alerts.length === 1 ? '' : 's'} to look at`}>
          {alerts.map((i) => <T key={i.key} size={13} tone="ink2">{i.merchant}: {i.change ? `price went from ${dollars(i.change.from, { decimals: true })} to ${dollars(i.change.to, { decimals: true })}` : i.health === 'late' ? `the ${dayLabel(i.nextDue)} charge has not appeared yet` : 'no charge for several cycles'}</T>)}
        </Banner>
      ) : null}

      <Card title="Coming in the next 30 days" right={<T size={13} bold>{dollars(upcomingTotal)}</T>}>
        {sum.upcoming.length ? sum.upcoming.map((u, k) => (
          <View key={`${u.key}${u.date}${k}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
            <T size={14} style={{ flex: 1 }}>{dayLabel(u.date)}  {u.merchant}</T><T size={14}>{dollars(u.cents, { decimals: true })}</T>
          </View>
        )) : <T size={13} tone="ink2">Nothing expected. These dates are projected from the last charge of each item.</T>}
      </Card>

      <Card title="Everything recurring" right={<T size={12} tone="ink3">Monthly cost, largest first</T>}>
        {!on.length ? <T size={13} tone="ink2">Nothing found yet. A charge counts once the same payee has billed you at least twice at a steady interval and similar amount. Groceries, fuel and shops are not counted unless you confirm them. Add anything the statements cannot show below.</T> : null}
        {on.map((i) => <Item key={i.key} item={i} />)}
      </Card>

      <Card title="Add a recurring charge" right={<T size={12} tone="ink3">For rent in cash, a yearly bill not seen yet</T>}>
        <TextInput value={name} onChangeText={setName} placeholder="Name, for example House rent" placeholderTextColor={C.ink3} accessibilityLabel="Name of the recurring charge" style={input} />
        <TextInput value={amount} onChangeText={setAmount} placeholder="Amount each time, for example 1500" placeholderTextColor={C.ink3} keyboardType="decimal-pad" accessibilityLabel="Amount each time" style={input} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{CADENCES.map((c) => <Chip key={c} label={CADENCE_LABEL[c]} on={cadence === c} onPress={() => setCadence(c)} />)}</View>
        <TextInput value={anchor} onChangeText={setAnchor} placeholder="A date it was or will be due, YYYY-MM-DD" placeholderTextColor={C.ink3} accessibilityLabel="A date it was or will be due" style={input} />
        <T size={12} tone="ink3">Later dates follow the rhythm from that date. {amount && canAdd ? `This adds ${dollars(Math.round(cents * { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12 }[cadence]))} a month.` : ''}</T>
        <View style={{ flexDirection: 'row' }}>
          <Button label="Add" disabled={!canAdd} onPress={() => { saveRecurring(addManual(recurring, { merchant: name, cents, cadence, anchor })); setName(''); setAmount(''); }} />
        </View>
      </Card>

      {aside.length ? (
        <Card title={`Set aside (${aside.length})`} right={<Button small kind="ghost" label={asideOpen ? 'Hide' : 'Show'} onPress={() => setAsideOpen(!asideOpen)} />}>
          <T size={12} tone="ink3">Not counted in the fixed amount. Restore one if you changed your mind.</T>
          {asideOpen ? aside.map((i) => <Item key={i.key} item={i} />) : null}
        </Card>
      ) : null}
      <View style={{ height: S.md }} />
    </Screen>
  );

  function Item({ item: i }: { item: RecurringItem }) {
    const set = (status: 'confirmed' | 'ignored' | 'cancelled' | null) => saveRecurring(decide(recurring, i.key, status));
    const manualId = i.key.startsWith('m:') ? i.key.slice(2) : null;
    const dimmed = i.status !== 'on' || i.health === 'stopped';
    return (
      <View style={{ gap: 2, paddingVertical: S.sm, borderTopWidth: 1, borderTopColor: C.line, opacity: dimmed ? 0.6 : 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
          <T size={15} bold style={{ flex: 1 }}>{i.merchant}</T>
          <T size={15} bold>{dollars(i.monthlyCents)}<T size={12} tone="ink3"> /mo</T></T>
        </View>
        <T size={13} tone="ink2">
          {i.varies ? 'About ' : ''}{dollars(i.cents, { decimals: true })} · {CADENCE_LABEL[i.cadence]} · {i.health === 'stopped' ? `last charged ${i.lastDate ? dayLabel(i.lastDate) : ''}, no longer charging` : `${i.projected ? 'next expected' : 'next was due'} ${dayLabel(i.nextDue)}`}
        </T>
        <T size={12} tone="ink3">
          {i.source === 'manual' ? 'Added by you' : `${i.count} charge${i.count === 1 ? '' : 's'} on your statements${i.source === 'confirmed' ? ', confirmed by you' : ', not confirmed yet'}`}
          {i.yearCents > 0 ? ` · ${dollars(i.yearCents)} in the last 12 months` : ''}
          {i.varies ? ' · amount varies' : ''}
          {i.change ? ` · price changed from ${dollars(i.change.from, { decimals: true })}` : ''}
          {i.health === 'late' && i.status === 'on' ? ' · charge is late' : ''}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {i.status === 'on' && i.source === 'detected' ? <Button small kind="outline" label="Confirm" onPress={() => set('confirmed')} /> : null}
          {i.status === 'on' ? <Button small kind="ghost" label="Not recurring" onPress={() => set('ignored')} /> : null}
          {i.status === 'on' ? <Button small kind="ghost" label="I cancelled it" onPress={() => set('cancelled')} /> : null}
          {i.status !== 'on' ? <Button small kind="outline" label="Restore" onPress={() => set(null)} /> : null}
          {i.txnIds.length ? <Button small kind="ghost" label="See charges" onPress={() => router.push({ pathname: '/ledger', params: { merchant: i.merchant } })} /> : null}
          {manualId ? <Button small kind="ghost" label="Remove" onPress={() => saveRecurring(removeManual(recurring, manualId))} /> : null}
        </View>
      </View>
    );
  }
}
