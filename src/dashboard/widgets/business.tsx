import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Columns, Ring } from '@/charts/dash';
import type { DashboardData } from '@/core/dashboard';
import { useRepo } from '@/data/repo';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R, TABULAR } from '@/theme/tokens';
import { AskStrip, LinkButton, Widget, WideButton, go } from '../frame';
import { BigMoney, exact, longMonth, monthSpan, pct0, shortMonth, signed, whole } from '../money';

type P = { d: DashboardData };

function Tile({ label, children, foot, hero, dashed }: { label: string; children: ReactNode; foot?: ReactNode; hero?: boolean; dashed?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 220, minHeight: 150, borderRadius: R.card, paddingVertical: 20, paddingHorizontal: 22, gap: 6, backgroundColor: hero ? c.hero : c.paper, borderWidth: hero ? 0 : 1, borderStyle: dashed ? 'dashed' : 'solid', borderColor: dashed ? c.line2 : c.line }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: hero ? '#FFFFFF' : c.ink2 }}>{label}</Text>
      {children}
      {foot ? <View style={{ marginTop: 'auto' }}>{foot}</View> : null}
    </View>
  );
}

/** 16. Business at a glance: tagged as business, waiting for an answer, likely tools per month, and business income. */
export function BizSummary({ d }: P) {
  const { c } = useTheme();
  const w = d.bizSummary;
  if (w.readiness === 'data') return <Widget title="Business at a glance" state={w} ghost="numbers" />;
  const merchants = d.bizPending.rows.length;
  const tools = d.bizTools.rows.filter((r) => !r.confirmed).map((r) => r.merchant);
  const foot = (t: string) => <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>{t}</Text>;
  return (
    <View accessibilityRole="summary" accessibilityLabel="Business at a glance" style={{ flex: 1, gap: 12 }}>
      {w.readiness === 'answers' && w.ask ? <AskStrip ask={w.ask} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <Tile hero label="Tagged as business" foot={<Text style={{ fontFamily: F.body, fontSize: 13, color: c.heroSoft }}>{w.tagged > 0 ? monthSpan(d.donut.from, d.donut.to) : merchants ? `Answer ${merchants} question${merchants === 1 ? '' : 's'} to start` : 'Nothing tagged yet'}</Text>}>
          <BigMoney cents={w.tagged} color="#FFFFFF" centsColor={c.heroSoft} />
        </Tile>
        <Tile label="Waiting for your answer" foot={foot(merchants ? `${merchants} merchant${merchants === 1 ? '' : 's'}, each charge counted once` : 'Nothing is waiting')}>
          <BigMoney cents={w.waiting} />
        </Tile>
        <Tile label="Likely business tools" foot={foot(tools.length ? tools.slice(0, 3).join(', ') + (tools.length > 3 ? ` and ${tools.length - 3} more` : '') : 'None undecided')}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}><BigMoney cents={w.toolsMonthly} /><Text style={{ fontFamily: F.display, fontSize: 18, color: c.ink3 }}>/mo</Text></View>
        </Tile>
        {w.income != null ? (
          <Tile label="Business income" foot={foot(`Deposits from your business income sources, ${monthSpan(d.donut.from, d.donut.to)}`)}><BigMoney cents={w.income} /></Tile>
        ) : (
          <Tile dashed label="Business income" foot={<LinkButton label="Add the account clients pay into" onPress={() => go('income')} />}>
            <Text style={{ fontFamily: F.display, fontSize: 26, letterSpacing: -0.6, color: c.ink2 }}>Not connected</Text>
          </Tile>
        )}
      </View>
    </View>
  );
}

/** 17. Business or personal? Each answer applies to every charge from that merchant. */
export function BizPending({ d }: P) {
  const { c } = useTheme();
  const { answerMany } = useRepo();
  const w = d.bizPending;
  return (
    <Widget title="Business or personal?" sub="Your answer applies to every charge from that store" state={w} ghost="list" gap={8} askAction={<View />}>
      {w.rows.length ? w.rows.map((r) => (
        <View key={r.question.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line }}>
          <View style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: c.ink }}>{r.merchant}</Text>
            <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink3 }}>{r.charges} charge{r.charges === 1 ? '' : 's'}</Text>
          </View>
          <Text style={[{ minWidth: 76, textAlign: 'right', fontFamily: F.bodyBold, fontSize: 15, color: c.ink }, TABULAR]}>{exact(r.cents)}</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={`${r.merchant}: business or personal`} style={{ flexDirection: 'row', gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${r.merchant} is business`} onPress={() => answerMany([r.question], 'business', true)}
              style={({ pressed }) => ({ minHeight: MIN_TOUCH, paddingHorizontal: 14, borderRadius: R.md, borderWidth: 1, borderColor: c.accent, backgroundColor: c.accentSoft, justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: c.accentInk }}>Business</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${r.merchant} is personal`} onPress={() => answerMany([r.question], 'personal', true)}
              style={({ pressed }) => ({ minHeight: MIN_TOUCH, paddingHorizontal: 14, borderRadius: R.md, borderWidth: 1, borderColor: c.line2, backgroundColor: c.paper, justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: c.ink }}>Personal</Text>
            </Pressable>
          </View>
        </View>
      )) : <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>All answered. Every charge that might be business has a decision.</Text>}
    </Widget>
  );
}

/** 18. Waiting, by merchant: the unanswered amount split by merchant. */
export function BizDonut({ d }: P) {
  const { c, series } = useTheme();
  const w = d.bizDonut;
  const colorAt = (i: number, name: string) => (name === 'Everything else' ? c.other : series[i % series.length]);
  return (
    <Widget title="Waiting, by merchant" sub="Not yet business or personal" state={w} ghost="ring" gap={16} askAction={<View />}>
      <View style={{ alignItems: 'center' }}>
        <Ring size={168} thickness={25} gapPct={0.8} parts={w.slices.map((s, i) => ({ value: s.cents, color: colorAt(i, s.merchant) }))} track={w.total > 0 ? undefined : c.track}
          label={`Donut: ${w.slices.map((s) => `${s.merchant} ${pct0(s.share)}`).join(', ') || 'nothing waiting'}`}>
          <Text style={[{ fontFamily: F.display, fontSize: 21, color: c.ink }, TABULAR]}>{exact(w.total)}</Text>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: c.ink3 }}>{d.bizPending.rows.length} merchant{d.bizPending.rows.length === 1 ? '' : 's'}</Text>
        </Ring>
      </View>
      <View style={{ gap: 4 }}>
        {w.slices.map((s, i) => (
          <View key={s.merchant} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 }}>
            <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: colorAt(i, s.merchant) }} />
            <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: c.ink }}>{s.merchant}</Text>
            <Text style={[{ width: 44, textAlign: 'right', fontFamily: F.body, fontSize: 14, color: c.ink3 }, TABULAR]}>{pct0(s.share)}</Text>
          </View>
        ))}
      </View>
    </Widget>
  );
}

/** 19. Software and tools: repeating charges that look like business, with "Mark all as business" for the undecided ones. */
export function BizTools({ d }: P) {
  const { c } = useTheme();
  const { answerMany } = useRepo();
  const w = d.bizTools;
  const undecided = w.rows.filter((r) => !r.confirmed);
  const yearly = w.rows.reduce((s, r) => s + r.yearly, 0);
  return (
    <Widget title="Software and tools" sub="Repeat monthly, likely business" state={w} ghost="list" gap={12} askAction={<View />}>
      <View>
        {w.rows.map((r) => (
          <View key={r.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, borderTopWidth: 1, borderTopColor: c.line, gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: c.ink }}>{r.merchant}{r.confirmed ? <Text style={{ color: c.goodInk, fontFamily: F.bodySemi }}>  Business</Text> : null}</Text>
            <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{exact(r.monthly)}/mo</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 2, borderTopColor: c.ink, paddingTop: 10 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }}>Per year</Text>
          <Text style={[{ fontFamily: F.display, fontSize: 18, color: c.ink }, TABULAR]}>{exact(yearly)}</Text>
        </View>
      </View>
      {w.undecided.length ? <WideButton solid label={`Mark ${undecided.length === 1 ? undecided[0].merchant : `all ${undecided.length}`} as business`} onPress={() => answerMany(w.undecided, 'business', true)} />
        : <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>Every tool here is decided.</Text>}
    </Widget>
  );
}

/** 20. Business profit and loss: business income minus business spending, per complete month. */
export function BizPL({ d }: P) {
  const { c } = useTheme();
  const w = d.bizPL;
  const total = w.months.reduce((s, m) => s + m.net, 0);
  return (
    <Widget title="Business profit and loss" sub="Income minus business spending, by complete month" state={w} ghost="bars">
      <Columns height={170} color={c.inn} negColor={c.out}
        bars={w.months.map((m) => ({ key: m.month, label: shortMonth(m.month), value: m.net, text: signed(m.net).replace('.00', '') }))}
        label={`Business profit and loss: ${w.months.map((m) => `${longMonth(m.month)} ${signed(m.net)}`).join(', ')}`} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 }}>
        <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>Over {w.months.length} month{w.months.length === 1 ? '' : 's'}: {whole(w.months.reduce((s, m) => s + m.income, 0))} in, {whole(w.months.reduce((s, m) => s + m.spend, 0))} out</Text>
        <Text style={[{ fontFamily: F.bodyBold, fontSize: 16, color: total >= 0 ? c.goodInk : c.bad }, TABULAR]}>{signed(total)}</Text>
      </View>
    </Widget>
  );
}
