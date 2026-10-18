import { View } from 'react-native';

import { monthLabel } from '@/core/dates';
import { useRepo } from '@/data/repo';
import { S } from '@/theme/tokens';
import { Chip, ChipRow, Segmented } from '@/theme/ui';

export function PeriodBar({ showScope = true }: { showScope?: boolean }) {
  const { months, period, setPeriod, scope, setScope } = useRepo();
  return (
    <View style={{ gap: S.sm }}>
      <ChipRow>
        {months.map((m) => <Chip key={m} label={monthLabel(m, true)} on={period === m} onPress={() => setPeriod(m)} />)}
        <Chip label="All" on={period === 'all'} onPress={() => setPeriod('all')} />
      </ChipRow>
      {showScope ? <Segmented value={scope} onChange={setScope} options={[{ value: 'all', label: 'Everything' }, { value: 'personal', label: 'Personal' }, { value: 'business', label: 'Business' }]} /> : null}
    </View>
  );
}
