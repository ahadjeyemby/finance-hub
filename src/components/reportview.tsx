import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { Bars, HBars } from '@/charts/bars';
import { ChartCard } from '@/charts/common';
import { LineChart } from '@/charts/lines';
import { Donut, StackBars } from '@/charts/stack';
import { dayLabel, monthLabel } from '@/core/dates';
import { forecastMonth } from '@/core/forecast';
import { dollars, listTxns, runQuery } from '@/core/queries';
import type { Ctx, QuerySpec } from '@/core/queries';
import { runStack } from '@/core/report';
import type { Block, ReportSpec } from '@/core/report';
import { toBarRows } from '@/lib/rows';
import { S } from '@/theme/tokens';
import { useColors, useTheme } from '@/theme/theme';
import { Banner, Button, Card, H, Row, T } from '@/theme/ui';
import { TxnRow } from './txnrow';
import { useTxPanel } from '@/components/txpanelctx';

const fmt = (spec: QuerySpec, v: number) => (spec.metric === 'count' ? String(v) : dollars(v, { decimals: false }));

function ChartBlock({ b, ctx, colorOf, completeTo }: { b: Extract<Block, { type: 'chart' }>; ctx: Ctx; colorOf: (c: string) => string; completeTo: string }) {
  const C = useColors();
  const { series: SERIES } = useTheme();
  const { openList } = useTxPanel();
  const g = b.query.groupBy;
  const res = useMemo(() => runQuery(b.query, ctx), [b, ctx]);
  const rows = toBarRows(res.rows, g, completeTo);
  const table = rows.map((r) => ({ label: r.label, value: r.value }));
  const series = (key: string, i: number) => (key === '__other' ? C.other : b.stackBy === 'category' ? colorOf(key) : SERIES[i] ?? C.other);
  if (b.chart === 'stack') {
    const data = runStack(b, ctx);
    return <ChartCard title={b.title} subtitle={b.subtitle} rows={data.series.map((s) => ({ label: s.label, value: s.total }))}><StackBars data={data} colorFor={series} /></ChartCard>;
  }
  return (
    <ChartCard title={b.title} subtitle={b.subtitle} rows={table}>
      {b.chart === 'bars' ? <Bars rows={rows} />
        : b.chart === 'line' || b.chart === 'area' ? <LineChart rows={rows} area={b.chart === 'area'} />
        : b.chart === 'donut' ? <Donut rows={rows} colorFor={(k, i) => (g === 'category' ? colorOf(k) : SERIES[i] ?? C.other)} />
        : <HBars rows={rows} onSelect={g === 'category' ? (k) => openList({ category: k, from: b.query.filter?.from, to: b.query.filter?.to }) : undefined} />}
    </ChartCard>
  );
}

export function ReportView({ spec, ctx, colorOf, dataTo, completeTo }: { spec: ReportSpec; ctx: Ctx; colorOf: (c: string) => string; dataTo: string; completeTo: string }) {
  const C = useColors();
  const empty = spec.period.from > dataTo;
  return (
    <View style={{ gap: S.lg }}>
      <View style={{ gap: 2 }}>
        <H size={22}>{spec.title}</H>
        {spec.subtitle ? <T size={12} tone="ink3">{spec.subtitle}</T> : null}
      </View>
      {empty ? <Banner title="No data in this period.">Your statements run to {dayLabel(dataTo)}. Pick an earlier period.</Banner> : null}
      {spec.notes?.map((n, i) => <Banner key={i} tone="info" title={n} />)}
      {spec.blocks.map((b, i) => {
        if (b.type === 'kpis') {
          return (
            <View key={i} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {b.items.map((it, j) => { const r = runQuery(it.query, ctx); return (
                <View key={j} style={{ flexGrow: 1, flexBasis: 140, backgroundColor: C.paper, borderRadius: 12, padding: S.md, gap: 2 }}>
                  <T size={12} tone="ink3">{it.label}</T><H size={22}>{fmt(it.query, r.total)}</H>{it.note ? <T size={11} tone="ink3">{it.note}</T> : null}
                </View>); })}
            </View>
          );
        }
        if (b.type === 'chart') return <ChartBlock key={i} b={b} ctx={ctx} colorOf={colorOf} completeTo={completeTo} />;
        if (b.type === 'table') {
          if (b.kind === 'groups' && b.query) { const r = runQuery(b.query, ctx); return <Card key={i} title={b.title}>{r.rows.map((x) => <Row key={x.key} label={x.label} value={fmt(b.query!, x.value)} />)}</Card>; }
          const txns = listTxns(ctx, b.filter ?? {}, b.limit ?? 25, b.order ?? 'date_desc');
          return <Card key={i} title={b.title}>{txns.map((t) => <TxnRow key={t.id} t={t} />)}{!txns.length ? <T size={13} tone="ink2">No transactions match.</T> : null}</Card>;
        }
        if (b.type === 'forecast') { const f = forecastMonth(ctx, b.month, dataTo); return <Card key={i} title={`Forecast: ${monthLabel(f.month)}`}><H size={26}>{dollars(f.total, { decimals: false })}</H><T size={13} tone="ink2">Likely {dollars(f.low, { decimals: false })} to {dollars(f.high, { decimals: false })}. {f.caveat}</T><Button small kind="outline" label="See how it is built" onPress={() => router.push('/forecast')} /></Card>; }
        return <Card key={i} title={b.title}><T size={14}>{b.text}</T></Card>;
      })}
    </View>
  );
}
