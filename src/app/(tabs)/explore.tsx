import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Bars, HBars } from '@/charts/bars';
import { ChartCard } from '@/charts/common';
import { ZoomGraph } from '@/charts/zoomgraph';
import { PeriodBar } from '@/components/filters';
import { ScreenHeader } from '@/components/header';
import { dollars, drillFilter, runQuery } from '@/core/queries';
import type { Filter, GroupBy, QuerySpec } from '@/core/queries';
import { useRepo } from '@/data/repo';
import { toBarRows } from '@/lib/rows';
import { S } from '@/theme/tokens';
import { Button, Card, Chip, ChipRow, Screen, Segmented, T } from '@/theme/ui';

const DIMS: { value: GroupBy; label: string }[] = [
  { value: 'category', label: 'Category' }, { value: 'merchant', label: 'Store' }, { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' }, { value: 'weekday', label: 'Weekday' }, { value: 'account', label: 'Account' }, { value: 'need_want', label: 'Needs and wants' },
];

type Drill = { label: string; filter: Filter };

export default function Explore() {
  const { ctx, scope, scoped, range, colorOf, accounts, completeTo } = useRepo();
  const [mode, setMode] = useState<'bars' | 'graph'>('bars');
  const [dim, setDim] = useState<GroupBy>('category');
  const [drills, setDrills] = useState<Drill[]>([]);

  const base = useMemo<Filter>(() => ({ ...scoped({ from: range.from, to: range.to }), ...(drills[drills.length - 1]?.filter ?? {}) }), [scoped, range, drills]);
  const spec = useMemo<QuerySpec>(() => ({ metric: 'spend', groupBy: dim, filter: base, limit: dim === 'merchant' ? 15 : undefined, foldOther: dim === 'merchant' }), [dim, base]);
  const res = useMemo(() => runQuery(spec, ctx), [ctx, spec]);
  const rows = toBarRows(res.rows, dim, completeTo).map((r) => dim === 'account' ? { ...r, label: accounts.find((a) => a.id === r.key)?.name ?? r.label } : r);
  const timeDim = dim === 'month' || dim === 'week' || dim === 'weekday';

  const drill = (key: string) => {
    if (key === '__other') return;
    const row = rows.find((r) => r.key === key);
    setDrills([...drills, { label: row?.label ?? key, filter: drillFilter(spec, key) }]);
  };
  const open = (f: Filter) => router.push({ pathname: '/ledger', params: { from: f.from, to: f.to, category: f.categories?.[0], merchant: f.merchants?.[0], kinds: f.kinds?.join(',') } });

  return (
    <Screen>
      <ScreenHeader title="Explore" sub="Dissect spending in any direction." />
      <Segmented value={mode} onChange={setMode} options={[{ value: 'bars', label: 'Bars' }, { value: 'graph', label: 'Graph' }]} />
      <PeriodBar showScope />
      {mode === 'graph' ? (
        <Card title="Year to item"><ZoomGraph ctx={ctx} scope={scope} colorOf={colorOf} onOpen={open} /></Card>
      ) : (
        <>
          <View style={{ gap: S.xs }}>
            <T size={12} bold tone="ink3">Group by</T>
            <ChipRow>{DIMS.map((d) => <Chip key={d.value} label={d.label} on={dim === d.value} onPress={() => setDim(d.value)} />)}</ChipRow>
          </View>
          {drills.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, alignItems: 'center' }}>
              <T size={12} tone="ink3">Inside:</T>
              {drills.map((d, i) => <Chip key={i} on label={`${d.label}  ×`} onPress={() => setDrills(drills.slice(0, i))} />)}
            </View>
          ) : null}
          <ChartCard title={`Spending by ${DIMS.find((d) => d.value === dim)!.label.toLowerCase()}`} subtitle={`${dollars(res.total)} across ${res.count} transactions. Tap a bar to go inside it.`} rows={rows.map((r) => ({ label: r.label, value: r.value }))}>
            {timeDim && dim !== 'weekday' ? <Bars rows={rows} onSelect={drill} /> : <HBars rows={rows} onSelect={drill} sub={(r) => { const n = res.rows.find((x) => x.key === r.key)?.count ?? 0; return `${n} purchase${n === 1 ? '' : 's'}`; }} />}
          </ChartCard>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button kind="outline" label="See transactions" onPress={() => open(base)} />
            {drills.length ? <Button kind="ghost" label="Clear" onPress={() => setDrills([])} /> : null}
          </View>
        </>
      )}
    </Screen>
  );
}
