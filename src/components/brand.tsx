import { Image } from 'expo-image';
import { Platform, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useTheme } from '@/theme/theme';
import { F, S } from '@/theme/tokens';
import { symbolColor, symbolReversed, wordmarkDark, wordmarkWhite } from './brandsvg';

// The Finora artwork from assets/brand/svg (see scripts/brand-svg.js). Light mode: the colour symbol and the dark wordmark. Dark mode: the reversed
// symbol and the white wordmark. On the web the browser draws the SVG itself (react-native-svg's web renderer leaks unknown attributes to the DOM).

function Art({ xml, width, height }: { xml: string; width: number; height: number }) {
  if (Platform.OS === 'web') return <Image source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(xml)}` }} style={{ width, height }} contentFit="contain" />;
  return <SvgXml xml={xml} width={width} height={height} />;
}

/** The Finora symbol. */
export function Logo({ size = 44 }: { size?: number }) {
  const { scheme } = useTheme();
  return <View accessible accessibilityRole="image" accessibilityLabel="Finora"><Art xml={scheme === 'dark' ? symbolReversed : symbolColor} width={size} height={size} /></View>;
}

/** The name "Finora" as lettering (467 by 122). */
export function Wordmark({ width = 104 }: { width?: number }) {
  const { scheme } = useTheme();
  return <View accessible accessibilityRole="image" accessibilityLabel="Finora"><Art xml={scheme === 'dark' ? wordmarkWhite : wordmarkDark} width={width} height={Math.round(width * (122 / 467))} /></View>;
}

/** The symbol and the name side by side, with the line "Your finances. In control." under the name when `tagline` is set. */
export function Lockup({ width = 260, tagline = true }: { width?: number; tagline?: boolean }) {
  const { c } = useTheme();
  const mark = Math.round(width * 0.24);
  return (
    <View accessible accessibilityLabel={tagline ? 'Finora. Your finances. In control.' : 'Finora'} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
      <Logo size={mark} />
      <View style={{ gap: 4 }}>
        <Wordmark width={Math.round(width * 0.6)} />
        {tagline ? <Text style={{ fontFamily: F.bodySemi, fontSize: Math.max(12, Math.round(width / 20)), color: c.ink2 }}>Your finances. In control.</Text> : null}
      </View>
    </View>
  );
}
