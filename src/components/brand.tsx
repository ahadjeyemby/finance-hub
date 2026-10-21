import { Image } from 'expo-image';

// The Finora artwork, from assets/brand. The symbol is the roof, bars and rising arrow; the lockup adds the name and the line "Your finances. In control."
const SYMBOL = require('../../assets/brand/png/01_symbol_color_256px.png');
const LOCKUP = require('../../assets/brand/png/09_logo_horizontal_color_1200px.png');

/** The Finora symbol on a transparent background. */
export function Logo({ size = 44 }: { size?: number }) {
  return <Image source={SYMBOL} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel="Finora" />;
}

/** The full logo: symbol, name and tagline side by side (about 3 to 1). */
export function Lockup({ width = 260 }: { width?: number }) {
  return <Image source={LOCKUP} style={{ width, height: Math.round(width * (391 / 1200)) }} contentFit="contain" accessibilityLabel="Finora. Your finances. In control." />;
}
