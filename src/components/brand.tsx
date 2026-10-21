import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

/** The Finora mark on its dark tile: a magnifier over a rising line. The same drawing as assets/brand/finora-icon.svg, which the app icon is made from. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityLabel="Finora" aria-label="Finora">
      <Rect width={1024} height={1024} rx={230} fill="#2B2D31" />
      <Circle cx={450} cy={450} r={245} fill="none" stroke="#E8E6E1" strokeWidth={64} />
      <Line x1={632} y1={632} x2={800} y2={800} stroke="#E8E6E1" strokeWidth={72} strokeLinecap="round" />
      <Polyline points="330,540 410,460 470,510 570,385" fill="none" stroke="#3FB6A8" strokeWidth={44} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={570} cy={385} r={34} fill="#3FB6A8" />
    </Svg>
  );
}
