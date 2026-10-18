import { useState } from 'react';
import { View } from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { dollars } from '@/core/queries';
import type { StackResult } from '@/core/report';
import { C, F, S } from '@/theme/tokens';
import { Legend, Measured, Readout, axisMoney, niceMax } from './common';
import type { BarRow } from './bars';

/** Stacked columns with a 2px surface gap between segments. */
export function StackBars({ data, colorFor, height = 220 }: { data: StackResult; colorFor: (key: string, i: number) => string; height?: number }) {
  const [sel, setSel] = useState<{ col: number; ser: string } | null>(null);
  const totals = data.cols.map((_, c) => data.series.reduce((s, x) => s + x.values[c], 0));
  const top = niceMax(Math.max(0, ...totals));
  const cur = sel ? { s: data.series.find((x) => x.key === sel.ser)!, c: data.cols[sel.col], v: data.series.find((x) => x.key === sel.ser)!.values[sel.col] } : null;
  return (
    <View style={{ gap: S.sm }}>
      <Readout label={cur ? `${cur.s.label}, ${cur.c.long}` : undefined} value={cur ? dollars(cur.v) : undefined} note={cur ? `of ${dollars(totals[sel!.col])}` : undefined} />
      <Measured height={height}>
        {(w) => {
          const L = 40, B = 22, T0 = 6, H = height - B - T0, plotW = w - L;
          const slot = plotW / data.cols.length, bw = Math.min(64, slot * 0.6);
          const y = (v: number) => T0 + (1 - v / top) * H;
          return (
            <Svg width={w} height={height}>
              {[0, 0.5, 1].map((f, i) => <G key={i}><Line x1={L} x2={w} y1={y(top * f)} y2={y(top * f)} stroke={C.line} /><SvgText x={L - 6} y={y(top * f) + 4} fontSize={10} fill={C.ink3} textAnchor="end" fontFamily={F.body}>{axisMoney(top * f)}</SvgText></G>)}
              {data.cols.map((c, ci) => {
                let acc = 0;
                const cx = L + slot * ci + slot / 2;
                return (
                  <G key={c.key}>
                    {data.series.map((s, si) => {
                      const v = s.values[ci];
                      if (v <= 0) return null;
                      const y1 = y(acc + v), y0 = y(acc);
                      acc += v;
                      const last = acc >= totals[ci] - 0.5;
                      return <Rect key={s.key} x={cx - bw / 2} y={y1 + 1} width={bw} height={Math.max(1, y0 - y1 - 2)} rx={last ? 4 : 1} fill={colorFor(s.key, si)} opacity={sel && !(sel.col === ci && sel.ser === s.key) ? 0.5 : 1} onPress={() => setSel(sel?.col === ci && sel.ser === s.key ? null : { col: ci, ser: s.key })} />;
                    })}
                    <SvgText x={cx} y={height - 6} fontSize={11} fill={C.ink2} textAnchor="middle" fontFamily={F.body}>{c.label}</SvgText>
                  </G>
                );
              })}
              <Line x1={L} x2={w} y1={y(0)} y2={y(0)} stroke={C.ink3} strokeWidth={1.5} />
            </Svg>
          );
        }}
      </Measured>
      <Legend items={data.series.map((s, i) => ({ label: s.label, color: colorFor(s.key, i) }))} />
    </View>
  );
}

/** Donut: share of a whole. Tap a slice for the exact figure. */
export function Donut({ rows, colorFor, size = 180 }: { rows: BarRow[]; colorFor: (key: string, i: number) => string; size?: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0) || 1;
  const cx = size / 2, R0 = size / 2 - 4, r0 = R0 * 0.62;
  const cur = rows.find((r) => r.key === sel);
  const pos = rows.filter((r) => r.value > 0);
  const arcs = pos.map((r, idx) => {
    const before = pos.slice(0, idx).reduce((s, x) => s + x.value, 0);
    const start = -Math.PI / 2 + (before / total) * Math.PI * 2;
    const sweep = (r.value / total) * Math.PI * 2;
    const a0 = start + 0.012, a1 = start + sweep - 0.012;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)} ${cx + rad * Math.sin(ang)}`;
    return { r, d: `M${p(R0, a0)} A${R0} ${R0} 0 ${big} 1 ${p(R0, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${big} 0 ${p(r0, a0)} Z` };
  });
  return (
    <View style={{ gap: S.sm, alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {arcs.map(({ r, d }, i) => <Path key={r.key} d={d} fill={r.color ?? colorFor(r.key, i)} opacity={sel && sel !== r.key ? 0.45 : 1} onPress={() => setSel(sel === r.key ? null : r.key)} />)}
        <SvgText x={cx} y={cx - 2} fontSize={11} fill={C.ink3} textAnchor="middle" fontFamily={F.body}>{cur ? cur.label : 'Total'}</SvgText>
        <SvgText x={cx} y={cx + 18} fontSize={20} fill={C.ink} textAnchor="middle" fontFamily={F.display}>{dollars(cur ? cur.value : total, { decimals: false })}</SvgText>
      </Svg>
      <Legend items={rows.map((r, i) => ({ label: `${r.label} ${Math.round((r.value / total) * 100)}%`, color: r.color ?? colorFor(r.key, i) }))} />
    </View>
  );
}
