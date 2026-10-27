import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CoverageTrack } from '@/charts/dash';
import type { CoverageRow, DashboardData } from '@/core/dashboard';
import { dayLabel } from '@/core/dates';
import { useTheme } from '@/theme/theme';
import { F, R, TABULAR } from '@/theme/tokens';
import { Chip, WarnNote, Widget, WideButton, openInbox } from '../frame';
import { exact } from '../money';

type P = { d: DashboardData };

/** 21. Needs your attention: how many questions are open, the three biggest, and the way to answer them. */
export function Attention({ d }: P) {
  const { c } = useTheme();
  const w = d.attention;
  return (
    <Widget title="Needs your attention" sub={w.count ? `The top ${w.top.length} cover ${exact(w.topCents)}` : 'Nothing is waiting'} state={w} ghost="list" gap={12}
      right={<Chip label={`${w.count} open`} tone={w.count ? 'accent' : 'good'} />}>
      {w.count ? (
        <View>
          {w.top.map((q) => (
            <Pressable key={q.id} accessibilityRole="link" accessibilityLabel={`${q.text}, ${exact(q.cents)}`} onPress={() => openInbox([q.id])}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderTopWidth: 1, borderTopColor: c.line }}>
              <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: c.ink }}>{q.text}</Text>
              <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{exact(q.cents)}</Text>
            </Pressable>
          ))}
        </View>
      ) : <Text style={{ fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.ink2 }}>Every question is answered. Add receipts or cash to keep it that way.</Text>}
      {w.count ? <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink3 }}>{exact(w.atStake)} in all, each charge counted once.</Text> : null}
      <WideButton solid label="Answer questions" onPress={() => openInbox()} />
    </Widget>
  );
}

/** 22. Data health: how much of the date range each account's statements cover, and money paid in from accounts Finora can't see. */
export function DataHealth({ d }: P) {
  const { c } = useTheme();
  const w = d.dataHealth;
  return (
    <Widget title="Data health" sub={`How much of ${dayLabel(w.from)} to ${dayLabel(w.to)} each account covers`} state={w} ghost="bars" gap={12}>
      <View style={{ gap: 12 }}>
        {w.accounts.map((a) => (
          <View key={a.accountId}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5, gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 13, color: c.ink }} numberOfLines={1}>{a.name}</Text>
              <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>{holes(a).length ? `${holes(a).length} missing, ` : ''}to {dayLabel(a.to)}</Text>
            </View>
            <CoverageTrack from={w.from} to={w.to} covered={a.coverage}
              label={`${a.name}: statements cover ${Math.round(a.share * 100)}% of the range${a.gaps.length ? `; missing ${a.gaps.map((g) => `${dayLabel(g.from)} to ${dayLabel(g.to)}`).join(', ')}` : ''}`} />
          </View>
        ))}
      </View>
      {w.unseenFunding > 0 ? <WarnNote>{exact(w.unseenFunding)} was paid into your cards from an account Finora can&apos;t see ({w.unseenCount} payment{w.unseenCount === 1 ? '' : 's'}). Add that account&apos;s statements to see where it came from.</WarnNote> : null}
      {w.missingCardStatements > 0 ? <Note>{w.missingCardStatements} card payment{w.missingCardStatements === 1 ? '' : 's'} from checking {w.missingCardStatements === 1 ? 'has' : 'have'} no matching card credit: a card statement is probably missing.</Note> : null}
      {w.receiptsWaiting > 0 ? <Note>{w.receiptsWaiting} receipt{w.receiptsWaiting === 1 ? ' is' : 's are'} dated after the newest statement. {w.receiptsWaiting === 1 ? 'It is' : 'They are'} counted once that statement is imported.</Note> : null}
    </Widget>
  );
}

/** Stretches with no statement before the account's last one: a statement that is missing, not days that are simply not over yet. */
const holes = (a: CoverageRow) => a.gaps.filter((g) => g.to < a.to);

function Note({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={{ backgroundColor: c.accentSoft, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12 }}><Text style={{ fontFamily: F.body, fontSize: 13, lineHeight: 19, color: c.ink }}>{children}</Text></View>;
}
