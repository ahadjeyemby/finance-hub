import { Pressable, Text, View } from 'react-native';

import { BarRows, Columns, Ring, SplitBar } from '@/charts/dash';
import { Icon } from '@/components/icons';
import type { IconName } from '@/components/icons';
import type { CutIdea, DashboardData } from '@/core/dashboard';
import { useTheme } from '@/theme/theme';
import { F, MIN_TOUCH, R, TABULAR } from '@/theme/tokens';
import { Widget, WarnNote, WideButton, go } from '../frame';
import { exact, longMonth, monthSpan, pct0, shortMonth, whole } from '../money';

type P = { d: DashboardData };

const IDEA_ICON: Record<CutIdea['kind'], IconName> = { basket: 'cart', bills: 'recurring', unsplit: 'receipt', rise: 'trend' };

/** 6. Where you could spend less: at most four ideas, each worked out from real purchases. */
export function CutIdeas({ d }: P) {
  const { c } = useTheme();
  const w = d.cutIdeas;
  return (
    <Widget title="Where you could spend less" sub="Found in your own purchases, not estimated" state={w} ghost="list" gap={8}>
      <View>
        {w.ideas.map((i) => (
          <View key={i.kind} style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ width: 44, height: 44, borderRadius: R.md, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon name={IDEA_ICON[i.kind]} color={c.accentInk} size={20} strokeWidth={1.9} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: c.ink }}>{i.title}</Text>
              <Text style={{ marginTop: 2, fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.ink2 }}>{i.text}</Text>
              <Pressable accessibilityRole="link" onPress={() => go(i.action.kind)} style={{ minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: c.accentInk }}>{i.action.label}</Text>
              </Pressable>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[{ fontFamily: F.display, fontSize: 20, color: c.ink }, TABULAR]}>{i.figure}</Text>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: c.ink3 }}>{i.unit}</Text>
            </View>
          </View>
        ))}
      </View>
    </Widget>
  );
}

/** 7. Fixed bills vs everyday: what repeats against the everyday average, with a warning when no housing or utility bill is seen. */
export function FixedFlex({ d }: P) {
  const { c } = useTheme();
  const w = d.fixedFlex;
  const row = (color: string, label: string, value: string) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} /><Text style={{ flexShrink: 1, fontFamily: F.body, fontSize: 14, color: c.ink }}>{label}</Text></View>
      <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{value}</Text>
    </View>
  );
  return (
    <Widget title="Fixed bills vs everyday" sub={`A typical month, from ${w.months} complete month${w.months === 1 ? '' : 's'}`} state={w} ghost="ring">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
        <Ring size={128} thickness={18} gapPct={0.8} parts={[{ value: w.fixed, color: c.accent }, { value: w.everyday, color: c.flexC }]} track={w.fixed + w.everyday > 0 ? undefined : c.track}
          label={`Ring: fixed bills ${pct0(w.share)}, everyday spending ${pct0(1 - w.share)}`}>
          <Text style={[{ fontFamily: F.display, fontSize: 24, color: c.ink }, TABULAR]}>{pct0(w.share)}</Text>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: c.ink3 }}>FIXED</Text>
        </Ring>
        <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
          {row(c.accent, 'Repeating bills', exact(w.fixed))}
          {row(c.flexC, 'Everyday, average', `~${whole(w.everyday)}`)}
        </View>
      </View>
      {w.fixed + w.everyday > 0 ? <Text style={{ fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.ink2 }}>{pct0(1 - w.share)} of a month is choices, so that&apos;s where cutting works.</Text> : null}
      {w.noHousing ? <WarnNote>No rent, mortgage or utility bill shows up. If they&apos;re paid from an account Finora can&apos;t see, this split is off.</WarnNote> : null}
    </Widget>
  );
}

/** 8. Repeating bills: one bar per bill, largest first, with monthly and yearly totals. */
export function Subscriptions({ d }: P) {
  const { c } = useTheme();
  const w = d.subscriptions;
  return (
    <Widget title="Repeating bills" sub={w.rows.length ? `${exact(w.monthly)} a month, ${exact(w.yearly)} a year` : 'Nothing repeats yet'} state={w} ghost="list"
      askAction={<Pressable accessibilityRole="link" onPress={() => go('recurring')} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: c.warnInk, textDecorationLine: 'underline' }}>Confirm bills</Text></Pressable>}>
      {w.rows.length ? (
        <BarRows rows={w.rows.slice(0, 8).map((r) => ({ key: r.key, name: r.merchant, value: r.monthly, text: exact(r.monthly) }))}
          label={`Repeating bills per month: ${w.rows.map((r) => `${r.merchant} ${exact(r.monthly)}`).join(', ')}`} />
      ) : <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>No charge has repeated on the statements so far. A bill you pay elsewhere can be added by hand.</Text>}
      {w.rows.length > 8 ? <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink3 }}>and {w.rows.length - 8} more</Text> : null}
      <WideButton label="Review repeating bills" onPress={() => go('recurring')} />
    </Widget>
  );
}

/** 9. Cheapest store for your basket: the items bought most, where each is cheapest, and the saving against the next cheapest. */
export function Grocery({ d }: P) {
  const { c } = useTheme();
  const w = d.grocery;
  return (
    <Widget title="Cheapest store for your basket" sub="Prices read from your receipts, compared by item name" state={w} ghost="table" gap={12}>
      <View accessibilityRole="list">
        {w.rows.map((r) => (
          <View key={r.item} accessible accessibilityLabel={`${r.item}: cheapest at ${r.store}, ${exact(r.price)}, ${exact(r.save)} less than at ${r.next}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: 1, borderTopColor: c.line }}>
            <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: c.ink }} numberOfLines={1}>{r.item}</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: c.goodSoft }}><Text style={[{ fontFamily: F.bodyBold, fontSize: 12, color: c.goodInk }, TABULAR]}>{r.store} {exact(r.price)}</Text></View>
            <Text style={[{ minWidth: 54, textAlign: 'right', fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>-{exact(r.save)}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 2, borderTopColor: c.ink, paddingTop: 10 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }}>Saved per basket</Text>
        <Text style={[{ fontFamily: F.display, fontSize: 18, color: c.goodInk }, TABULAR]}>{exact(w.perBasket)}</Text>
      </View>
      <Text style={{ fontFamily: F.body, fontSize: 12, color: c.ink3 }}>Buying each item at its cheapest store instead of the next cheapest.</Text>
    </Widget>
  );
}

/** 10. Big-box stores: spending split by store, with the way to split it by item. */
export function BigBox({ d }: P) {
  const { c, cat } = useTheme();
  const w = d.bigbox;
  const shades = [cat.bigbox, mix(cat.bigbox, c.paper, 0.45), mix(cat.bigbox, c.ink, 0.35), mix(cat.bigbox, c.paper, 0.7)];
  return (
    <Widget title="Big-box stores" sub={w.total > 0 ? `${monthSpan(d.donut.from, d.donut.to)}, ${exact(w.total)}` : monthSpan(d.donut.from, d.donut.to)} state={w} ghost="split">
      {w.rows.length ? (
        <>
          <SplitBar parts={w.rows.map((r, i) => ({ value: r.cents, color: shades[i % shades.length] }))} label={w.rows.map((r) => `${r.merchant} ${pct0(r.share)}`).join(', ')} />
          <View style={{ gap: 6 }}>
            {w.rows.map((r, i) => (
              <View key={r.merchant} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 }}>
                <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: shades[i % shades.length] }} />
                <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: c.ink }}>{r.merchant}</Text>
                <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{exact(r.cents)}</Text>
                <Text style={[{ width: 44, textAlign: 'right', fontFamily: F.body, fontSize: 14, color: c.ink3 }, TABULAR]}>{pct0(r.share)}</Text>
              </View>
            ))}
          </View>
          {w.unsplit > 0 ? <Text style={{ fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.ink2 }}>{w.unsplit >= w.total ? 'No item detail yet' : `${exact(w.unsplit)} has no item detail yet`}, so it can&apos;t be split into groceries, home and the rest.</Text> : null}
        </>
      ) : <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>No big-box store spending on the statements so far.</Text>}
      <WideButton label="Add receipts to split" onPress={() => go('receipts')} />
    </Widget>
  );
}

/** 11. Fuel: spent, fill-ups and the average fill-up; monthly bars with the partial month hatched; the station used most. */
export function Fuel({ d }: P) {
  const { c, cat } = useTheme();
  const w = d.fuel;
  const stat = (label: string, value: string) => (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: c.ink3 }}>{label}</Text>
      <Text style={[{ fontFamily: F.display, fontSize: 18, color: c.ink }, TABULAR]}>{value}</Text>
    </View>
  );
  return (
    <Widget title="Fuel" sub={monthSpan(d.donut.from, d.donut.to)} state={w} ghost="bars">
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {stat('Spent', exact(w.spent))}
        {stat('Fill-ups', String(w.fillUps))}
        {stat('Average', w.fillUps ? exact(w.average) : '-')}
      </View>
      <Columns height={120} color={cat.fuel} bars={w.months.map((m) => ({ key: m.month, label: shortMonth(m.month), value: m.cents, text: whole(m.cents), hatch: m.partial }))}
        label={`Fuel by month: ${w.months.map((m) => `${longMonth(m.month)} ${exact(m.cents)}${m.partial ? ' so far' : ''}`).join(', ')}`} />
      {w.top ? <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}><Text style={{ fontFamily: F.bodyBold, color: c.ink }}>{w.top.merchant}</Text> took {pct0(w.top.share)} of fuel spending.</Text>
        : <Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>No fuel on the statements so far.</Text>}
    </Widget>
  );
}

/** Blend two hex colours: shades of one category colour for the stores inside it. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => { const n = parseInt(h.replace('#', '').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
