import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { dollars } from '@/core/queries';
import { F, S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { T } from '@/theme/ui';
import { HatchDefs, Measured, Readout, axisMoney, niceMax } from './common';

export interface BarRow { key: string; label: string; value: number; long?: string; hatch?: boolean; note?: string; color?: string }

/** Vertical bars (months, weeks). Negative values hang below the baseline. Hatched = partial period. */
export function Bars({ rows, height = 190, color: colorProp, onSelect }: { rows: BarRow[]; height?: number; color?: string; onSelect?: (key: string) => void }) {
  const C = useColors();
  const color = colorProp ?? C.bar;
  const [sel, setSel] = useState<string | null>(null);
  const hid = 'hb' + Math.abs(hash(color));
  const pos = Math.max(0, ...rows.map((r) => r.value));
  const neg = Math.min(0, ...rows.map((r) => r.value));
  const top = niceMax(pos), bot = neg < 0 ? -niceMax(-neg) : 0;
  const cur = rows.find((r) => r.key === sel);
  return (
    <View style={{ gap: S.xs }}>
      <Readout label={cur ? (cur.long ?? cur.label) : undefined} value={cur ? dollars(cur.value) : undefined} note={cur?.hatch ? 'Incomplete period' : cur?.note} />
      <Measured height={height}>
        {(w) => {
          const L = 40, B = 22, T0 = 6, H = height - B - T0, plotW = w - L;
          const y = (v: number) => T0 + ((top - v) / (top - bot)) * H;
          const slot = plotW / rows.length, bw = Math.min(56, slot * 0.6);
          return (
            <View style={{ width: w, height }}>
            <Svg width={w} height={height}>
              <HatchDefs id={hid} color={color} />
              {[0, 0.5, 1].map((f, i) => { const v = bot + (top - bot) * f; return <G key={i}><Line x1={L} x2={w} y1={y(v)} y2={y(v)} stroke={C.line} /><SvgText x={L - 6} y={y(v) + 4} fontSize={10} fill={C.ink3} textAnchor="end" fontFamily={F.body}>{axisMoney(v)}</SvgText></G>; })}
              {rows.map((r, i) => {
                const cx = L + slot * i + slot / 2;
                const y0 = y(0), y1 = y(r.value);
                return (
                  <G key={r.key}>
                    <Rect x={cx - bw / 2} y={Math.min(y0, y1)} width={bw} height={Math.max(1, Math.abs(y1 - y0))} rx={4} fill={r.hatch ? `url(#${hid})` : r.color ?? color} stroke={r.hatch ? color : undefined} strokeWidth={r.hatch ? 1 : 0} opacity={sel && sel !== r.key ? 0.45 : 1} />
                    <SvgText x={cx} y={height - 6} fontSize={11} fill={sel === r.key ? C.ink : C.ink2} fontFamily={sel === r.key ? F.bodyBold : F.body} textAnchor="middle">{r.label}</SvgText>
                  </G>
                );
              })}
              <Line x1={L} x2={w} y1={y(0)} y2={y(0)} stroke={C.ink3} strokeWidth={1.5} />
            </Svg>
            <View style={{ position: 'absolute', left: L, right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
              {rows.map((r) => (
                <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={`${r.long ?? r.label}, ${dollars(r.value)}`} style={{ flex: 1 }}
                  onPress={() => { setSel(sel === r.key ? null : r.key); onSelect?.(r.key); }} />
              ))}
            </View>
            </View>
          );
        }}
      </Measured>
    </View>
  );
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/** Horizontal ranked bars. Hatched bars mean the dollars have no item detail yet. */
export function HBars({ rows, color: colorProp, max, onSelect, sub }: { rows: BarRow[]; color?: string; max?: number; onSelect?: (key: string) => void; sub?: (r: BarRow) => string | undefined }) {
  const C = useColors();
  const color = colorProp ?? C.bar;
  const m = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <View>
      {rows.map((r) => {
        const pct = Math.max(1, (Math.abs(r.value) / m) * 100);
        return (
          <Pressable key={r.key} accessibilityRole={onSelect ? 'button' : undefined} accessibilityLabel={`${r.label}, ${dollars(r.value)}`} disabled={!onSelect} onPress={() => onSelect?.(r.key)}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <View style={{ width: 132 }}>
              <T size={13} numberOfLines={2}>{r.label}</T>
              {sub?.(r) ? <T size={11} tone="ink3" numberOfLines={1}>{sub(r)}</T> : null}
            </View>
            <View style={{ flex: 1, height: 12, backgroundColor: C.line, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', borderTopRightRadius: 5, borderBottomRightRadius: 5, backgroundColor: r.hatch ? C.paper : r.color ?? color, borderWidth: r.hatch ? 1.5 : 0, borderColor: r.color ?? color, borderStyle: r.hatch ? 'dashed' : 'solid' }} />
            </View>
            <T size={13} bold style={{ width: 72, textAlign: 'right' }}>{dollars(r.value, { decimals: false })}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
