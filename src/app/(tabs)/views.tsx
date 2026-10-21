import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { ScreenHeader } from '@/components/header';
import { allCategories } from '@/core/categories';
import { monthLabel } from '@/core/dates';
import { dollars, matches } from '@/core/queries';
import { groupCents, tagTotals } from '@/core/tags';
import { useRepo } from '@/data/repo';
import { C, S } from '@/theme/tokens';
import { Button, Card, Chip, Screen, T } from '@/theme/ui';

/** The overall picture across categories: each tag as its own total, plus the Want group. These overlap on purpose and are never added together. */
export default function Views() {
  const { txns, tagState, months, period, setPeriod, range } = useRepo();
  const inPeriod = useMemo(() => txns.filter((t) => matches(t, { from: range.from, to: range.to, kinds: ['spend', 'fee', 'refund'] })), [txns, range.from, range.to]);
  const totals = useMemo(() => tagTotals(inPeriod, tagState.defs), [inPeriod, tagState.defs]);
  const wants = useMemo(() => groupCents(inPeriod, 'want'), [inPeriod]);
  const all = inPeriod.reduce((s, t) => s - t.cents, 0);
  const go = (params: Record<string, string>) => router.push({ pathname: '/ledger', params: { from: range.from, to: range.to, ...params } });

  return (
    <Screen max={820}>
      <ScreenHeader back title="Views" sub={`The overall picture for ${range.label}. Total spending in this period: ${dollars(all)}.`}
        right={<Button small kind="outline" label="Categories and tags" onPress={() => router.push('/categories')} />} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {months.slice(-12).map((m) => <Chip key={m} label={monthLabel(m, true)} on={period === m} onPress={() => setPeriod(m)} />)}
        <Chip label="All" on={period === 'all'} onPress={() => setPeriod('all')} />
      </View>
      <T size={12} tone="ink3">Each view counts what belongs to it, down to single items on a receipt. A charge can be in several views at once (a pharmacy item bought at a big-box store is both Health and Household), so these totals overlap and are not meant to add up to the total.</T>

      {totals.map((x) => {
        const def = tagState.defs.find((d) => d.id === x.tag)!;
        const share = all > 0 ? Math.min(1, Math.max(0, x.cents / all)) : 0;
        return (
          <Card key={x.tag} title={def.label} right={<T size={12} tone="ink3">{x.count} charge{x.count === 1 ? '' : 's'}</T>}>
            <T size={28} bold>{dollars(x.cents)}</T>
            <View style={{ height: 8, backgroundColor: C.line, borderRadius: 4, overflow: 'hidden' }}><View style={{ width: `${Math.max(share * 100, x.cents > 0 ? 2 : 0)}%`, height: '100%', backgroundColor: C.bar, borderRadius: 4 }} /></View>
            <T size={12} tone="ink3">{all > 0 ? `${(share * 100).toFixed(1)}% of spending in this period` : 'No spending in this period'}</T>
            {x.stores.length ? <T size={13} tone="ink2">Biggest: {x.stores.map((s) => `${s.merchant} ${dollars(s.cents)}`).join(', ')}</T> : <T size={13} tone="ink2">Nothing tagged {def.label} in this period.</T>}
            <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="See the charges" disabled={!x.count} onPress={() => go({ tags: x.tag })} /></View>
          </Card>
        );
      })}

      <Card title="Extras (wants)" right={<T size={12} tone="ink3">Want categories</T>}>
        <T size={28} bold>{dollars(wants)}</T>
        <T size={12} tone="ink3">{all > 0 ? `${((wants / all) * 100).toFixed(1)}% of spending. ` : ''}Everything in categories you have marked Want: {allCategories().filter((c) => c.group === 'want').map((c) => c.label).join(', ') || 'none yet'}. Move a category between Need and Want in Categories and tags.</T>
        <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="See the charges" onPress={() => go({ group: 'want' })} /></View>
      </Card>
      <View style={{ height: S.md }} />
    </Screen>
  );
}
