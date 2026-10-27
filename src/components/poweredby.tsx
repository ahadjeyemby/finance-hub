import { Text } from 'react-native';

import { useColors } from '@/theme/theme';
import { F } from '@/theme/tokens';

/**
 * "Powered by Sparktrum", in the side bar footer and at the foot of the phone dashboard. The Sparktrum logo has not been supplied yet: when it
 * arrives (a wide SVG, plus a white version for dark mode), it replaces the text here and nowhere else.
 */
export function PoweredBy() {
  const C = useColors();
  return <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.ink3 }}>Powered by Sparktrum</Text>;
}
