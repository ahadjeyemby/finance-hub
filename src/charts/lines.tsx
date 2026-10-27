import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { dollars } from '@/core/queries';
import { F, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Measured, Readout, axisMoney, niceMax } from './common';
import type { BarRow } from './bars';

/** Line or area over ordered points (weeks, days, months). Touch or drag to read a point. */
export function LineChart({ rows, area, height = 190, color: colorProp }: { rows: BarRow[]; area?: boolean; height?: number; color?: string }) {
  const C = useColors();
  const color = colorProp ?? C.bar;
  const [sel, setSel] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...rows.map((r) => r.value)));
  const cur = sel != null ? rows[sel] : undefined;
  return (
    <View style={{ gap: S.xs }}>
      <Readout label={cur ? (cur.long ?? cur.label) : undefined} value={cur ? dollars(cur.value) : undefined} note={cur?.hatch ? 'Incomplete period' : undefined} />
      <Measured height={height}>
        {(w) => {
          const L = 40, B = 22, T0 = 8, R0 = 8, H = height - B - T0, plotW = w - L - R0;
          const n = rows.length;
          const x = (i: number) => L + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
          const y = (v: number) => T0 + (1 - v / top) * H;
          const pts = rows.map((r, i) => [x(i), y(r.value)] as const);
          const path = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ');
          const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 54))));
          const at = (lx: number) => Math.max(0, Math.min(n - 1, Math.round(((lx - L) / plotW) * (n - 1))));
          return (
            <View style={{ width: w, height }}
              onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => setSel(at(e.nativeEvent.locationX))} onResponderMove={(e) => setSel(at(e.nativeEvent.locationX))}>
              <Svg width={w} height={height} pointerEvents="none">
                {[0, 0.5, 1].map((f, i) => <G key={i}><Line x1={L} x2={w} y1={y(top * f)} y2={y(top * f)} stroke={C.line} /><SvgText x={L - 6} y={y(top * f) + 4} fontSize={10} fill={C.ink3} textAnchor="end" fontFamily={F.body}>{axisMoney(top * f)}</SvgText></G>)}
                {area ? <Path d={`${path} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={color} opacity={0.14} /> : null}
                <Path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                {rows.map((r, i) => i % every === 0 ? <SvgText key={r.key} x={x(i)} y={height - 6} fontSize={11} fill={C.ink2} textAnchor="middle" fontFamily={F.body}>{r.label}</SvgText> : null)}
                {sel != null ? <><Line x1={x(sel)} x2={x(sel)} y1={T0} y2={T0 + H} stroke={C.ink3} strokeDasharray="3 3" /><Circle cx={x(sel)} cy={pts[sel][1]} r={5} fill={color} stroke={C.paper} strokeWidth={2} /></> : null}
              </Svg>
            </View>
          );
        }}
      </Measured>
    </View>
  );
}
