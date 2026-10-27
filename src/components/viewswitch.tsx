import { View } from 'react-native';

import { memberName } from '@/core/workspace';
import { useRepo } from '@/data/repo';
import { S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Chip, T } from '@/theme/ui';

/**
 * For a person who manages a workspace: whose data is on every screen. Me, one member, or Everyone. It only chooses among rows the database already
 * lets this person read. Nothing is shown to a person with no members.
 */
export function ViewSwitch() {
  const C = useColors();
  const { team } = useRepo();
  if (!team.active) return null;
  const who = team.viewing === 'all' ? 'everyone' : team.viewing === 'me' ? 'you' : memberName(team.members.find((m) => m.member === team.viewing) ?? { member: team.viewing, email: null, label: null });
  return (
    <View style={{ paddingHorizontal: S.md, paddingVertical: S.xs, gap: 2, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.paper }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <T size={12} tone="ink3" bold>Showing</T>
        <Chip label="Me" on={team.viewing === 'me'} onPress={() => team.setViewing('me')} />
        {team.members.map((m) => <Chip key={m.member} label={memberName(m)} on={team.viewing === m.member} onPress={() => team.setViewing(m.member)} />)}
        <Chip label="Everyone" on={team.viewing === 'all'} onPress={() => team.setViewing('all')} />
      </View>
      {team.viewing !== 'me' ? <T size={11} tone="ink3">Showing {who}. Totals, categories and tags you change here are your own view; the member&apos;s own screens do not change.</T> : null}
    </View>
  );
}
