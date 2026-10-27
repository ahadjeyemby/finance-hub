import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Key, Ring, StackedColumns, Waterfall } from '@/charts/dash';
import { CATEGORY_GROUP_LABEL, CATEGORY_GROUPS, F, R, TABULAR } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { useWide } from '@/theme/ui';
import type { DashboardData } from '@/core/dashboard';
import { monthEnd, monthStart } from '@/core/dates';
import { AskStrip, LinkButton, Widget } from '../frame';
import { BigMoney, exact, longMonth, monthSpan, pct0, pct1, shortMonth, signed, whole } from '../money';

type P = { d: DashboardData };

function Tile({ label, children, foot, hero, dashed }: { label: string; children: ReactNode; foot?: ReactNode; hero?: boolean; dashed?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 220, minHeight: 150, borderRadius: R.card, paddingVertical: 20, paddingHorizontal: 22, gap: 6,
      backgroundColor: hero ? c.hero : c.paper, borderWidth: hero ? 0 : 1, borderStyle: dashed ? 'dashed' : 'solid', borderColor: dashed ? c.line2 : c.line }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: hero ? c.onHero : c.ink2 }}>{label}</Text>
      {children}
      {foot ? <View style={{ marginTop: 'auto' }}>{foot}</View> : null}
    </View>
  );
}

function TileChip({ text, tone }: { text: string; tone: 'hero' | 'warn' | 'plain' }) {
  const { c } = useTheme();
  const bg = tone === 'hero' ? c.heroChip : tone === 'warn' ? c.warnBg : c.seg;
  const ink = tone === 'hero' ? c.onHero : tone === 'warn' ? c.warnInk : c.ink2;
  return <View style={{ alignSelf: 'flex-start', minHeight: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: bg, justifyContent: 'center' }}><Text style={[{ fontFamily: F.bodyBold, fontSize: 13, color: ink }, TABULAR]}>{text}</Text></View>;
}

/** 1. Month at a glance: Spent (the hero), Earned, Left after spending, Rewards. */
export function Kpis({ d }: P) {
  const { c } = useTheme();
  const k = d.kpis;
  if (k.readiness === 'data') return <Widget title="Month at a glance" state={k} ghost="numbers" />;
  const when = k.month ? `${longMonth(k.month)}${k.complete ? '' : ' so far'}` : 'all months';
  const change = 'pct' in k.change ? `${Math.abs(Math.round(k.change.pct * 100))}% ${k.change.pct <= 0 ? 'less' : 'more'} than ${longMonth(k.change.prevMonth)}` : null;
  return (
    <View accessibilityRole="summary" accessibilityLabel={`Month at a glance, ${when}`} style={{ flex: 1, gap: 12 }}>
      {k.readiness === 'answers' && k.ask ? <AskStrip ask={k.ask} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <Tile hero label={`Spent ${k.month ? 'in ' : 'across '}${when}`} foot={<TileChip tone="hero" text={change ?? ('none' in k.change ? (k.complete ? 'No month to compare with' : 'Not finished yet') : '')} />}>
          <BigMoney cents={k.spent} color={c.onHero} centsColor={c.heroSoft} />
        </Tile>
        <Tile label="Earned" foot={k.unconfirmed > 0 ? <TileChip tone="warn" text="Not confirmed yet" /> : <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>{k.incomeIncomplete ? 'Only the connected accounts are counted' : 'Deposits confirmed'}</Text>}>
          <BigMoney cents={k.earned} />
        </Tile>
        <Tile label="Left after spending" foot={<Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>Earned minus spent</Text>}>
          <BigMoney cents={k.left} sign color={k.left >= 0 ? c.goodInk : c.bad} />
        </Tile>
        <Tile label="Rewards" foot={<Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>Kept apart from earnings</Text>}>
          <BigMoney cents={k.rewards} />
        </Tile>
      </View>
    </View>
  );
}

/** 2. Money in vs out: Earned rising from zero, Spent coming down from it, Left as the rest. */
export function Cashflow({ d }: P) {
  const { c } = useTheme();
  const w = d.cashflow;
  const sub = d.kpis.month ? `${longMonth(d.kpis.month)}${d.kpis.complete ? '' : ' so far'}` : 'All months';
  const note = (color: string, head: string, body: string) => (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color, marginTop: 5 }} />
      <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.ink2 }}><Text style={{ fontFamily: F.bodyBold, color: c.ink }}>{head}</Text> {body}</Text>
    </View>
  );
  return (
    <Widget title="Money in vs out" sub={sub} state={w} ghost="waterfall"
      right={<LinkButton label="See every deposit" onPress={() => router.push({ pathname: '/ledger', params: { kinds: 'income', ...(d.kpis.month ? { from: monthStart(d.kpis.month), to: monthEnd(d.kpis.month) } : {}) } })} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
        <View style={{ flexGrow: 1, flexBasis: 320, minWidth: 0 }}>
          <Waterfall earned={w.earned} spent={w.spent} money={(v, s) => (s ? signed(v) : exact(v))} label={`Waterfall: earned ${exact(w.earned)}, spent ${exact(w.spent)}, left ${signed(w.left)}`} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 200, gap: 12 }}>
          {w.unconfirmed > 0 ? note(c.inn, 'Earned is not confirmed.', `${exact(w.unconfirmed)} of deposits wait for your answer in the Inbox.`) : note(c.inn, 'Earned is confirmed.', 'Every deposit in this period has an answer.')}
          {note(c.line2, 'Not counted:', `${exact(w.transfers)} of card payments and transfers, so nothing is counted twice.`)}
        </View>
      </View>
    </Widget>
  );
}

/** 3. Where it went: the six category groups across every month with statements. */
export function Donut({ d }: P) {
  const { c, cat } = useTheme();
  const w = d.donut;
  const months = d.trend.months.length;
  return (
    <Widget title="Where it went" sub={`${monthSpan(w.from, w.to)}, every account`} state={w} ghost="ring" gap={16}>
      <View style={{ alignItems: 'center' }}>
        <Ring size={176} thickness={26} gapPct={0.6} parts={w.slices.map((s) => ({ value: s.cents, color: cat[s.group] }))} track={w.total > 0 ? undefined : c.track}
          label={`Donut of spending by category: ${w.slices.map((s) => `${CATEGORY_GROUP_LABEL[s.group]} ${pct1(s.share)}`).join(', ') || 'no spending'}.`}>
          <Text style={[{ fontFamily: F.display, fontSize: 22, letterSpacing: -0.5, color: c.ink }, TABULAR]}>{whole(w.total)}</Text>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: c.ink3 }}>{months} month{months === 1 ? '' : 's'}</Text>
        </Ring>
      </View>
      {w.slices.length ? (
        <View style={{ gap: 4 }}>
          {w.slices.map((s) => (
            <View key={s.group} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 }}>
              <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: cat[s.group] }} />
              <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: c.ink }}>{CATEGORY_GROUP_LABEL[s.group]}</Text>
              <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{whole(s.cents)}</Text>
              <Text style={[{ width: 52, textAlign: 'right', fontFamily: F.body, fontSize: 14, color: c.ink3 }, TABULAR]}>{pct1(s.share)}</Text>
            </View>
          ))}
        </View>
      ) : <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>No spending on the statements so far.</Text>}
      {w.netCredit > 0 ? <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink3 }}>{exact(w.netCredit)} of refunds came back in a category with less spending than that, so it has no slice; the total is after refunds.</Text> : null}
    </Widget>
  );
}

/** 4. Spending by month: category stacks, the chosen month outlined, partial months hatched, the average of full months dashed. */
export function Trend({ d }: P) {
  const { c, cat } = useTheme();
  const w = d.trend;
  const partial = w.months.filter((m) => m.partial);
  const shown = CATEGORY_GROUPS.filter((g) => w.months.some((m) => m.byGroup[g] > 0));
  // on a phone the columns are narrow: the average is said under the chart instead of on it
  const wide = useWide();
  return (
    <Widget title="Spending by month" state={w} ghost="bars"
      sub={w.average != null ? `By category. The dashed line is the average of the ${w.averageOf} full month${w.averageOf === 1 ? '' : 's'}, one-offs left out.` : 'By category. No month is complete yet, so there is no average.'}
      right={<LinkButton label="Explore" onPress={() => router.navigate('/explore')} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 }}>{shown.map((g) => <Key key={g} color={cat[g]}>{CATEGORY_GROUP_LABEL[g]}</Key>)}</View>
      <StackedColumns
        cols={w.months.map((m) => ({ key: m.month, label: shortMonth(m.month), total: whole(m.total), note: m.partial ? 'so far' : undefined, hatch: m.partial, selected: m.month === w.selected, parts: CATEGORY_GROUPS.map((g) => ({ value: m.byGroup[g], color: cat[g] })) }))}
        average={w.average} averageLabel={w.average != null && wide ? `Average ${whole(w.average)}` : undefined}
        label={`Stacked bars: ${w.months.map((m) => `${longMonth(m.month)} ${whole(m.total)}${m.partial ? ' so far' : ''}`).join(', ')}.${w.average != null ? ` Average of full months ${whole(w.average)}.` : ''}`} />
      {!wide && w.average != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 18, borderTopWidth: 2, borderStyle: 'dashed', borderColor: c.ink2 }} />
          <Text style={[{ fontFamily: F.body, fontSize: 13, color: c.ink2 }, TABULAR]}>Average of full months: <Text style={{ fontFamily: F.bodyBold, color: c.ink }}>{whole(w.average)}</Text></Text>
        </View>
      ) : null}
      {partial.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 18, height: 12, borderRadius: 3, borderWidth: 1, borderColor: c.ink3, backgroundColor: c.seg }} />
          <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>Hatched: {partial.map((m) => longMonth(m.month)).join(', ')} {partial.length === 1 ? 'is' : 'are'} not finished.</Text>
        </View>
      ) : null}
    </Widget>
  );
}

/** 5. One-offs vs normal months: the share of spending marked one-time, the largest, and the total without them. */
export function OneTime({ d }: P) {
  const { c } = useTheme();
  const w = d.oneTime;
  return (
    <Widget title="One-offs vs normal months" sub={monthSpan(d.donut.from, d.donut.to)} state={w} ghost="ring">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
        <Ring size={128} thickness={18} gapPct={0} parts={[{ value: w.oneOffs, color: c.out }]} total={Math.max(1, w.total)} track={c.track} label={`Ring: one-time spending is ${pct0(w.share)} of all spending`}>
          <Text style={[{ fontFamily: F.display, fontSize: 24, color: c.ink }, TABULAR]}>{pct0(w.share)}</Text>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: c.ink3 }}>ONE-OFFS</Text>
        </Ring>
        <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, lineHeight: 21, color: c.ink2 }}>
          {w.largest ? <><Text style={{ fontFamily: F.bodyBold, color: c.ink }}>{w.largest.merchant}, {exact(w.largest.cents)}</Text> in {longMonth(w.largest.date.slice(0, 7))}. Left out of forecasts so one trip doesn&apos;t inflate every month.</> : 'Nothing is marked one-time.'}
          {w.pending > 0 ? ` ${exact(w.pending)} more may be one-time: answer in the Inbox.` : ''}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 }}>
        <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>Without them, {monthSpan(d.donut.from, d.donut.to)}</Text>
        <Text style={[{ fontFamily: F.bodyBold, fontSize: 16, color: c.ink }, TABULAR]}>{exact(w.withoutOneOffs)}</Text>
      </View>
    </Widget>
  );
}

