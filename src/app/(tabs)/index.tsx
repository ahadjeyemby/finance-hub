import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Bars, HBars } from '@/charts/bars';
import { ChartCard } from '@/charts/common';
import { PeriodBar } from '@/components/filters';
import { ScreenHeader } from '@/components/header';
import { dayLabel, monthEnd, monthLabel } from '@/core/dates';
import { forecastMonth } from '@/core/forecast';
import { dollars, runQuery, summarize } from '@/core/queries';
import { categoryRows } from '@/lib/rows';
import { useRepo } from '@/data/repo';
import { C, F, S } from '@/theme/tokens';
import { Banner, Button, Card, Row, Screen, T, TapeCard, useWide } from '@/theme/ui';

export default function Overview() {
  const { ctx, scope, scoped, range, period, dataTo, questions, forecastMonth: fcMonth, completeTo, links } = useRepo();
  // receipts are evidence, not transactions: ones dated after the newest statement have no month here until their statement is imported
  const waiting = (links?.receipts ?? []).filter((r) => r.date && r.date > dataTo);
  const wide = useWide();
  const s = summarize(ctx, range.from, range.to, scope);
  const f = scoped({ from: range.from, to: range.to });
  const cats = categoryRows(ctx, f, 6);
  const monthRows = runQuery({ metric: 'spend', groupBy: 'month', sort: 'key', filter: scoped() }, ctx).rows.map((r) => ({ key: r.key, label: monthLabel(r.key, true), long: monthLabel(r.key), value: r.value, hatch: monthEnd(r.key) > completeTo }));
  const atStake = questions.reduce((a, q) => a + q.cents, 0);
  const fc = forecastMonth(ctx, fcMonth, dataTo);
  const title = period === 'all' ? 'All data' : monthLabel(period);
  const state = period === 'all' ? `through ${dayLabel(dataTo)}` : range.complete ? 'complete' : 'partial';
  const whole = Math.floor(Math.abs(s.spent) / 100);
  const cents = String(Math.abs(s.spent) % 100).padStart(2, '0');

  const headline = (
    <TapeCard>
      <T size={12} tone="ink3">{title}, {state}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text style={{ fontFamily: F.display, fontSize: 42, letterSpacing: -1.4, color: C.ink, lineHeight: 48 }}>${whole.toLocaleString('en-US')}</Text>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.ink3 }}>.{cents}</Text>
        <T size={13} tone="ink2" style={{ marginLeft: 4 }}>spent</T>
      </View>
      <View style={{ gap: 6, marginTop: S.xs }}>
        <Row label="Earned" value={dollars(s.earned)} onPress={() => router.push({ pathname: '/ledger', params: { kinds: 'income', from: s.from, to: s.to } })} />
        <Row label="Rewards" value={dollars(s.rewards)} onPress={() => router.push({ pathname: '/ledger', params: { kinds: 'rewards', from: s.from, to: s.to } })} />
        <T size={12} tone="ink3">Tap Earned or Rewards to see every deposit behind the number.</T>
        <Row strong label="Left after spending" value={dollars(s.net, { sign: true })} tone={s.net < 0 ? 'bad' : undefined} />
      </View>
    </TapeCard>
  );

  const banners = (
    <View style={{ gap: S.sm }}>
      {waiting.length ? <Banner tone="info" title={`${waiting.length} receipt${waiting.length > 1 ? 's are' : ' is'} dated after ${dayLabel(dataTo)}, the end of your newest statement.`}>This page is built from statements, so a month appears only when a statement covers it. The receipts are saved and will be linked and counted once that statement is imported. Open Receipt links to see them.</Banner> : null}
      {waiting.length ? <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="Open Receipt links" onPress={() => router.push('/links')} /></View> : null}
      {s.incomeIncomplete && scope !== 'business' ? <Banner title="Income looks incomplete.">Only deposits into the connected checking account count. Other accounts that receive pay are not connected, so Earned may be low.</Banner> : null}
      {s.unconfirmedIncome > 0 ? <Banner title={`${dollars(s.unconfirmedIncome)} of Earned is unconfirmed.`}>The bank statement hides who sent these deposits. If any is a reimbursement or a move from your own account, answer in the Inbox and it comes out of Earned.</Banner> : null}
      {s.partialAccounts.length ? <Banner tone="info" title="Some statements end before this period does.">{s.partialAccounts.map((a) => `${a.name} to ${dayLabel(a.coveredTo)}`).join(', ')}. Late days may be missing.</Banner> : null}
    </View>
  );

  const left = (
    <View style={{ gap: S.lg, flex: 1 }}>
      {headline}
      <ChartCard title="Where it went" subtitle="Dashed bars are big-box and online baskets with no item detail yet." rows={cats.map((c) => ({ label: c.label, value: c.value }))}>
        <HBars rows={cats} onSelect={(k) => router.push({ pathname: '/ledger', params: { category: k, from: range.from, to: range.to } })} />
      </ChartCard>
      <ChartCard title="Spending by month" subtitle="Hatched months are missing days." rows={monthRows.map((m) => ({ label: m.long, value: m.value }))}>
        <Bars rows={monthRows} />
      </ChartCard>
    </View>
  );
  const right = (
    <View style={{ gap: S.lg, flex: 1 }}>
      <Card title="Questions">
        <T size={14}>{questions.length ? `${questions.length} questions cover ${dollars(atStake, { decimals: false })}. Answering the top few fixes most of the picture.` : 'Nothing is waiting. Add receipts or cash to keep it that way.'}</T>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <Button label="Answer questions" onPress={() => router.push('/inbox')} style={{ flex: 1 }} />
        </View>
      </Card>
      <Card title={`Forecast for ${monthLabel(fc.month)}`} right={<T size={12} tone="ink3">{fc.confidence} confidence</T>}>
        <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink }}>{dollars(fc.total, { decimals: false })}</Text>
        <T size={13} tone="ink2">Likely between {dollars(fc.low, { decimals: false })} and {dollars(fc.high, { decimals: false })}. {fc.caveat}</T>
        <Button kind="outline" label="See how it is built" onPress={() => router.push('/forecast')} />
      </Card>
      <Card title="Ask about your money">
        <T size={13} tone="ink2">Questions like “how much did I spend on fuel in August” or “what changed since July”.</T>
        <Button kind="outline" label="Ask" onPress={() => router.push('/ask')} />
      </Card>
      <Card title="More">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          <Button small kind="outline" label="All transactions" onPress={() => router.push('/ledger')} />
          <Button small kind="outline" label="Accounts and data" onPress={() => router.push('/accounts')} />
          <Button small kind="outline" label="Receipt links" onPress={() => router.push('/links')} />
          <Button small kind="outline" label="Recurring" onPress={() => router.push('/recurring')} />
          <Button small kind="outline" label="Views" onPress={() => router.push('/views')} />
          <Button small kind="outline" label="Categories and tags" onPress={() => router.push('/categories')} />
          <Button small kind="outline" label="Prices" onPress={() => router.push('/prices')} />
        </View>
      </Card>
    </View>
  );

  return (
    <Screen>
      <ScreenHeader title="Overview" sub={`Data to ${dayLabel(dataTo)}`} />
      <PeriodBar />
      {banners}
      {wide ? <View style={{ flexDirection: 'row', gap: S.lg, alignItems: 'flex-start' }}>{left}{right}</View> : <>{left}{right}</>}
    </Screen>
  );
}
