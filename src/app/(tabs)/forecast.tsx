import { HBars } from '@/charts/bars';
import { ChartCard } from '@/charts/common';
import { ScreenHeader } from '@/components/header';
import { categoryLabel } from '@/core/categories';
import { dayLabel, monthLabel } from '@/core/dates';
import { forecastMonth } from '@/core/forecast';
import { dollars } from '@/core/queries';
import { useRepo } from '@/data/repo';
import { C, F } from '@/theme/tokens';
import { Banner, Card, Row, Screen, T } from '@/theme/ui';
import { Text } from 'react-native';

export default function Forecast() {
  const { ctx, forecastMonth: month, dataTo } = useRepo();
  const fc = forecastMonth(ctx, month, dataTo);
  const rows = fc.variableByCategory.map((v) => ({ key: v.category, label: v.label || categoryLabel(v.category), value: v.estimate }));
  return (
    <Screen max={820}>
      <ScreenHeader back title={`${monthLabel(fc.month)}`} sub={`Forecast from data to ${dayLabel(dataTo)}`} />
      <Card>
        <Text style={{ fontFamily: F.display, fontSize: 40, color: C.ink, letterSpacing: -1 }}>{dollars(fc.total, { decimals: false })}</Text>
        <T size={14}>Likely between {dollars(fc.low, { decimals: false })} and {dollars(fc.high, { decimals: false })}. Confidence: {fc.confidence}.</T>
        <T size={13} tone="ink2">{fc.caveat}</T>
        <T size={12} tone="ink3">Built from {fc.basisMonths.length} complete month{fc.basisMonths.length === 1 ? '' : 's'}: {fc.basisMonths.map((m) => monthLabel(m, true)).join(', ') || 'none yet'}. Business spending and one-time expenses are left out.</T>
      </Card>
      {fc.basisMonths.length < 3 ? <Banner title="Few months of history.">With under three complete months, treat the range as the answer and the middle number as a guess.</Banner> : null}
      <Card title="Bills that repeat" right={<T size={13} bold>{dollars(fc.recurringTotal, { decimals: false })}</T>}>
        {fc.recurring.length ? fc.recurring.map((r) => <Row key={r.merchant} label={`${r.merchant} (${r.months} mo)`} value={dollars(r.typical)} />) : <T size={13} tone="ink2">No charge has repeated in two or more months at a similar amount yet.</T>}
      </Card>
      <ChartCard title="Everything else, by category" subtitle={`About ${dollars(fc.variableTotal, { decimals: false })} based on typical months.`} rows={rows.map((r) => ({ label: r.label, value: r.value }))}>
        <HBars rows={rows} />
      </ChartCard>
      {fc.oneOffsExcluded.length ? (
        <Card title="Left out as one-time">
          {fc.oneOffsExcluded.map((o, i) => <Row key={i} label={`${o.merchant}, ${dayLabel(o.date)}`} value={dollars(o.cents)} />)}
          <T size={12} tone="ink3">Change this on a transaction if it does repeat.</T>
        </Card>
      ) : null}
      {fc.pace ? <Card title="This month so far"><T size={13}>{dollars(fc.pace.spentSoFar)} spent in {fc.pace.daysElapsed} days, a pace of {dollars(fc.pace.paceTotal, { decimals: false })}. The forecast leans {Math.round(fc.pace.weight * 100)}% on pace.</T></Card> : null}
    </Screen>
  );
}
