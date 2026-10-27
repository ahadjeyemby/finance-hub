import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { PaceLine, RangeBand, SplitBar } from '@/charts/dash';
import type { DashboardData } from '@/core/dashboard';
import { dayLabel } from '@/core/dates';
import { addManual } from '@/core/recurring';
import { useRepo } from '@/data/repo';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R, TABULAR } from '@/theme/tokens';
import type { ViewId } from '../views';
import { Chip, LinkButton, Widget, go } from '../frame';
import { exact, longMonth, shortMonth, whole } from '../money';

type P = { d: DashboardData; view: ViewId };

const CONFIDENCE = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const;

/** 12. Next month forecast: the best guess, its range on a 0-to-max scale, and how sure it is. */
export function Forecast({ d, view }: P) {
  const { c } = useTheme();
  const w = d.forecast;
  const f = w.forecast;
  const basis = f ? (f.basisMonths.length === 1 ? longMonth(f.basisMonths[0]) : `${shortMonth(f.basisMonths[0])} to ${shortMonth(f.basisMonths[f.basisMonths.length - 1])}`) : '';
  return (
    <Widget title={`${longMonth(w.target)} forecast`} sub={f ? `Built from ${basis}` : undefined} state={w} ghost="range" gap={12}
      right={f ? <Chip label={CONFIDENCE[f.confidence]} tone={f.confidence === 'low' ? 'warn' : f.confidence === 'medium' ? 'neutral' : 'good'} /> : undefined}>
      {f ? (
        <>
          <Text accessibilityLabel={`Best guess ${whole(f.total)}`} style={[{ fontFamily: F.display, fontSize: 44, letterSpacing: -1.4, lineHeight: 50, color: c.ink }, TABULAR]}>{whole(f.total)}</Text>
          <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>Likely between {whole(f.low)} and {whole(f.high)}</Text>
          <RangeBand low={f.low} high={f.high} mark={f.total} max={w.max} label={`Range ${whole(f.low)} to ${whole(f.high)} on a scale of 0 to ${whole(w.max)}, best guess ${whole(f.total)}`} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.body, fontSize: 12, color: c.ink3 }}>$0</Text>
            <Text style={[{ fontFamily: F.body, fontSize: 12, color: c.ink3 }, TABULAR]}>{whole(w.max)}</Text>
          </View>
          <Text style={{ marginTop: 'auto', fontFamily: F.body, fontSize: 14, lineHeight: 21, color: c.ink2 }}>{f.basisMonths.length < 4 ? `${f.basisMonths.length} full month${f.basisMonths.length === 1 ? '' : 's'} so far. The range is the real message.` : f.caveat}</Text>
          {view === 'plan' ? <LinkButton label="See how it is built" onPress={() => go('forecast')} /> : <LinkButton label="Open Plan ahead" onPress={() => router.setParams({ view: 'plan' })} />}
        </>
      ) : null}
    </Widget>
  );
}

/** 13. What next month is made of: repeating bills against the everyday average, what is left out on purpose, and the bills seen once. */
export function ForecastBuild({ d, view }: P) {
  const { c } = useTheme();
  const w = d.forecastBuild;
  const f = w.forecast;
  const tile = (head: string, label: string, value: string) => (
    <View style={{ flexGrow: 1, flexBasis: 240, backgroundColor: c.seg, borderRadius: R.lg, padding: 14 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 0.8, color: c.ink3 }}>{head}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: c.ink }}>{label}</Text>
        <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{value}</Text>
      </View>
    </View>
  );
  const row = (color: string, label: string, value: string) => (
    <View style={{ flexGrow: 1, flexBasis: 200, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} /><Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink }}>{label}</Text></View>
      <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{value}</Text>
    </View>
  );
  const pending = f ? f.oneOffsExcluded.filter((o) => !o.confirmed) : [];
  const confirmed = f ? f.oneOffsExcluded.filter((o) => o.confirmed) : [];
  return (
    <Widget title={`What ${longMonth(w.target)} is made of`} sub={f ? `Forecast ${whole(f.total)}, likely ${whole(f.low)} to ${whole(f.high)}` : undefined} state={w} ghost="split"
      askAction={w.ask && !w.ask.questionIds.length ? <LinkButton label={view === 'plan' ? 'Mark them in Bills seen once' : 'Open Plan ahead'} onPress={() => router.setParams({ view: 'plan' })} /> : undefined}>
      {f ? (
        <>
          <SplitBar height={28} parts={[{ value: f.recurringTotal, color: c.accent }, { value: f.variableTotal, color: c.flexC }]}
            label={`Repeating bills ${exact(f.recurringTotal)}; everyday spending about ${whole(f.variableTotal)}`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 10 }}>
            {row(c.accent, 'Repeating bills', exact(f.recurringTotal))}
            {row(c.flexC, 'Everyday, average', `~${whole(f.variableTotal)}`)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 14 }}>
            {tile('LEFT OUT ON PURPOSE', confirmed.length ? `${confirmed.length === 1 ? confirmed[0].merchant : `${confirmed.length} charges`}, one-time${pending.length ? `; ${pending.length} more waiting` : ''}` : pending.length ? `${pending.length} large charge${pending.length === 1 ? '' : 's'}, waiting for your answer` : 'Nothing', exact(w.oneOffs))}
            {tile('IF THE BILLS SEEN ONCE REPEAT', w.ifBillsRepeat != null ? `${longMonth(w.target)} rises to about` : 'No bill has been seen only once', w.ifBillsRepeat != null ? whole(w.ifBillsRepeat) : '-')}
          </View>
        </>
      ) : null}
    </Widget>
  );
}

/** 14. Month pace: the month so far against a straight line to the forecast. */
export function Pace({ d }: P) {
  const { c } = useTheme();
  const w = d.pace;
  const name = longMonth(w.month);
  const mid = Math.ceil(w.daysInMonth / 2);
  return (
    <Widget title={`${name} pace`} sub="Spending so far against the forecast, one-offs left out" state={w} ghost="line">
      {w.forecast != null ? (
        <>
          <PaceLine daily={w.daily} days={w.daysInMonth} forecast={w.forecast} endLabel={`Forecast ${whole(w.forecast)} by ${shortMonth(w.month)} ${w.daysInMonth}`}
            label={`${exact(w.spent)} spent in the first ${w.days} days of ${name}, against a forecast of ${whole(w.forecast)} for the month`} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[1, mid, w.daysInMonth].map((day) => <Text key={day} style={{ fontFamily: F.body, fontSize: 12, color: c.ink3 }}>{shortMonth(w.month)} {day}</Text>)}
          </View>
          <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>
            <Text style={{ fontFamily: F.bodyBold, color: c.ink }}>{exact(w.spent)}</Text> in {w.days} days. A straight line to the forecast would be {whole(w.expectedByNow ?? 0)} by now.
          </Text>
        </>
      ) : null}
    </Widget>
  );
}

/** 15. Bills seen once: say whether each repeats. The answer goes into the recurring bills and the forecast at once. */
export function BillsOnce({ d }: P) {
  const { c } = useTheme();
  const { recurring, saveRecurring, patchTxn } = useRepo();
  const w = d.billsOnce;
  const button = (label: string, onPress: () => void, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: MIN_TOUCH, borderRadius: R.md, borderWidth: 1, borderColor: c.line2, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: c.ink }}>{label}</Text>
    </Pressable>
  );
  return (
    <Widget title="Bills seen once" sub="Mark them, and the forecast updates" state={w} ghost="list" gap={10} askAction={<View />}>
      {w.bills.length ? w.bills.map((b) => (
        <View key={b.txnId} style={{ gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.line }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={2} style={{ fontFamily: F.bodyBold, fontSize: 15, color: c.ink }}>{b.merchant}</Text><Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink3 }}>Seen {dayLabel(b.date)}</Text></View>
            <Text style={[{ fontFamily: F.bodyBold, fontSize: 15, color: c.ink }, TABULAR]}>{exact(b.cents)}</Text>
          </View>
          <View accessibilityRole="radiogroup" accessibilityLabel={`${b.merchant}: repeats or one-time`} style={{ flexDirection: 'row', gap: 6 }}>
            {button('Repeats monthly', () => saveRecurring(addManual(recurring, { merchant: b.merchant, cents: b.cents, cadence: 'monthly', anchor: b.date, category: b.category })), `${b.merchant} repeats monthly`)}
            {button('One-time', () => patchTxn(b.txnId, { oneOff: true }), `${b.merchant} was one-time`)}
          </View>
        </View>
      )) : <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>Nothing seen only once. Every bill so far either repeats or has an answer.</Text>}
    </Widget>
  );
}
