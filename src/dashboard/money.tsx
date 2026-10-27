import { Text, View } from 'react-native';

import { monthLabel } from '@/core/dates';
import { dollars } from '@/core/queries';
import { useTheme } from '@/theme/theme';
import { F, TABULAR } from '@/theme/tokens';

export const whole = (cents: number) => dollars(cents, { decimals: false });
export const exact = (cents: number) => dollars(cents);
export const signed = (cents: number) => dollars(cents, { sign: true });
export const pct1 = (share: number) => `${(share * 100).toFixed(1)}%`;
export const pct0 = (share: number) => `${Math.round(share * 100)}%`;
export const shortMonth = (ym: string) => monthLabel(ym, true);
export const longMonth = (ym: string) => monthLabel(ym).split(' ')[0];
/** "Jun to Oct", or one month's name */
export const monthSpan = (from: string, to: string) => (from.slice(0, 7) === to.slice(0, 7) ? monthLabel(from.slice(0, 7)) : `${shortMonth(from.slice(0, 7))} to ${shortMonth(to.slice(0, 7))}`);

/** A large amount: dollars in Sora, the cents smaller and quieter, always in tabular figures. */
export function BigMoney({ cents, size = 40, color, centsColor, sign }: { cents: number; size?: number; color?: string; centsColor?: string; sign?: boolean }) {
  const { c } = useTheme();
  const abs = Math.abs(cents);
  const head = `${cents < 0 ? '-' : sign && cents > 0 ? '+' : ''}$${Math.floor(abs / 100).toLocaleString('en-US')}`;
  const tail = `.${String(abs % 100).padStart(2, '0')}`;
  return (
    <View accessible accessibilityLabel={dollars(cents, { sign })} style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text style={[{ fontFamily: F.display, fontSize: size, letterSpacing: -0.035 * size, lineHeight: size * 1.15, color: color ?? c.ink }, TABULAR]}>{head}</Text>
      <Text style={[{ fontFamily: F.displayMed, fontSize: Math.round(size * 0.55), color: centsColor ?? c.ink3 }, TABULAR]}>{tail}</Text>
    </View>
  );
}
