import { useId } from 'react';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme/theme';
import { F, TABULAR } from '@/theme/tokens';
import { Measured } from './common';

// The dashboard's charts. They follow the brief's drawing rules: donuts and rings are SVG arcs with a small gap between slices, hatching is a
// 135-degree line pattern over the card colour, simple bars are Views or SVG, and every chart is an image with a label that states its numbers.

const sid = (raw: string) => `h${raw.replace(/[^a-zA-Z0-9]/g, '')}`;

/** 135-degree stripes of `color` over the card colour: a partial month, or a stretch with no statement. */
export function HatchPattern({ id, color, gap = 3, width = 3 }: { id: string; color: string; gap?: number; width?: number }) {
  const { c } = useTheme();
  const size = gap + width;
  return (
    <Pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
      <Rect width={size} height={size} fill={c.paper} />
      <Rect width={width} height={size} fill={color} />
    </Pattern>
  );
}

export interface RingPart { value: number; color: string }

/**
 * A donut or ring: one arc per part, each shortened by `gapPct` of the circle so neighbouring slices never touch. `track` fills the rest when
 * the parts add up to less than `total`.
 */
export function Ring({ parts, total, size = 176, thickness = 26, gapPct = 0.8, track, label, children }: { parts: RingPart[]; total?: number; size?: number; thickness?: number; gapPct?: number; track?: string; label: string; children?: ReactNode }) {
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
  const live = parts.filter((p) => p.value > 0);
  const gap = live.length > 1 ? (gapPct / 100) * circ : 0;
  let at = 0;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {track ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={thickness} fill="none" /> : null}
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {sum > 0 ? live.map((p, i) => {
            const len = Math.max(0.5, (p.value / sum) * circ - gap);
            const el = <Circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={p.color} strokeWidth={thickness} fill="none" strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-at} />;
            at += (p.value / sum) * circ;
            return el;
          }) : null}
        </G>
      </Svg>
      {children}
    </View>
  );
}

/** A horizontal bar split into parts with 3px gaps, rounded at the ends. */
export function SplitBar({ parts, height = 20, label }: { parts: RingPart[]; height?: number; label: string }) {
  const live = parts.filter((p) => p.value > 0);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 3, height }}>
      {live.map((p, i) => (
        <View key={i} style={{ flex: p.value, backgroundColor: p.color, borderTopLeftRadius: i === 0 ? 8 : 0, borderBottomLeftRadius: i === 0 ? 8 : 0, borderTopRightRadius: i === live.length - 1 ? 8 : 0, borderBottomRightRadius: i === live.length - 1 ? 8 : 0 }} />
      ))}
    </View>
  );
}

/** The forecast's range on a 0-to-max scale: a band from low to high and a mark at the best guess. */
export function RangeBand({ low, high, mark, max, label }: { low: number; high: number; mark: number; max: number; label: string }) {
  const { c } = useTheme();
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%` as const;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ height: 40 }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 16, height: 8, borderRadius: 4, backgroundColor: c.track }} />
      <View style={{ position: 'absolute', left: pct(low), width: `${Math.max(1, ((high - low) / max) * 100)}%`, top: 12, height: 16, borderRadius: 8, backgroundColor: c.range }} />
      <View style={{ position: 'absolute', left: pct(mark), top: 4, width: 4, height: 32, marginLeft: -2, borderRadius: 2, backgroundColor: c.ink }} />
    </View>
  );
}

/** Earned rising from zero, Spent hanging down from the Earned total, Left as what remains (below zero when more went out than came in). */
export function Waterfall({ earned, spent, label, money }: { earned: number; spent: number; label: string; money: (v: number, sign?: boolean) => string }) {
  const { c } = useTheme();
  const left = earned - spent;
  const top = Math.max(earned, left, 1), bottom = Math.min(0, left);
  const H = 250, labelRoom = 26, plot = H - labelRoom;
  const y = (v: number) => labelRoom + ((top - v) / (top - bottom)) * plot;
  const bars = [
    { name: 'Earned', from: 0, to: earned, fill: c.inn, text: money(earned) },
    { name: 'Spent', from: earned, to: left, fill: c.out, text: money(-spent, true) },
    { name: 'Left', from: 0, to: left, fill: left >= 0 ? c.accent : c.bad, text: money(left, true) },
  ];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Measured height={H}>
        {(w) => {
          const slot = w / 3, bw = Math.min(120, slot - 20);
          return (
            <Svg width={w} height={H}>
              {bars.map((b, i) => {
                const y1 = y(Math.max(b.from, b.to)), y2 = y(Math.min(b.from, b.to));
                const x = slot * i + (slot - bw) / 2;
                return (
                  <G key={b.name}>
                    <Path d={roundTop(x, y1, bw, Math.max(4, y2 - y1), 10)} fill={b.fill} />
                    <SvgText x={x + bw / 2} y={y1 - 8} fontSize={15} fontFamily={F.bodyBold} fill={c.ink} textAnchor="middle">{b.text}</SvgText>
                  </G>
                );
              })}
              <Line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke={c.line2} strokeWidth={2} />
            </Svg>
          );
        }}
      </Measured>
      <View style={{ flexDirection: 'row', paddingTop: 8 }}>
        {bars.map((b) => <Text key={b.name} style={{ flex: 1, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 14, color: c.ink2 }}>{b.name}</Text>)}
      </View>
    </View>
  );
}

const roundTop = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h} V${y + rr} Q${x} ${y} ${x + rr} ${y} H${x + w - rr} Q${x + w} ${y} ${x + w} ${y + rr} V${y + h} Z`;
};

export interface StackCol { key: string; label: string; total: string; /** a short line above the total, such as "so far" */ note?: string; parts: RingPart[]; hatch: boolean; selected: boolean }

/** Stacked columns with 2px gaps; hatched columns are partial periods; the selected one is outlined; an optional dashed average line. */
export function StackedColumns({ cols, height = 270, average, averageLabel, label }: { cols: StackCol[]; height?: number; average?: number | null; averageLabel?: string; label: string }) {
  const { c } = useTheme();
  const raw = useId();
  const max = Math.max(1, ...cols.map((col) => col.parts.reduce((s, p) => s + p.value, 0)), average ?? 0);
  const totalRoom = 26;
  // room above the tallest stack for its total, and for the 2px gaps and minimum heights of its segments
  const plot = height - totalRoom - 30 - (cols.some((col) => col.note) ? 16 : 0);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Measured height={height}>
        {(w) => {
          const slot = w / Math.max(1, cols.length), bw = Math.min(100, slot - 14);
          const scale = (v: number) => (v / max) * plot;
          return (
            <Svg width={w} height={height}>
              <Defs>{cols.flatMap((col) => col.hatch ? col.parts.map((p, i) => <HatchPattern key={`${col.key}${i}`} id={`${sid(raw)}${col.key.replace(/\W/g, '')}${i}`} color={p.color} />) : [])}</Defs>
              {cols.map((col, ci) => {
                const x = slot * ci + (slot - bw) / 2;
                let yAt = height;
                const live = col.parts.filter((p) => p.value > 0);
                const top = height - live.reduce((s, p) => s + Math.max(3, scale(p.value)), 0) - (live.length - 1) * 2;
                return (
                  <G key={col.key}>
                    {live.map((p, i) => {
                      const h = Math.max(3, scale(p.value));
                      const yy = yAt - h;
                      yAt = yy - 2;
                      const fill = col.hatch ? `url(#${sid(raw)}${col.key.replace(/\W/g, '')}${col.parts.indexOf(p)})` : p.color;
                      return i === live.length - 1 ? <Path key={i} d={roundTop(x, yy, bw, h, 8)} fill={fill} stroke={col.hatch ? p.color : undefined} strokeWidth={col.hatch ? 1 : 0} />
                        : <Rect key={i} x={x} y={yy} width={bw} height={h} fill={fill} stroke={col.hatch ? p.color : undefined} strokeWidth={col.hatch ? 1 : 0} />;
                    })}
                    {col.selected ? <Rect x={x - 5} y={top - 5} width={bw + 10} height={height - top + 3} rx={10} fill="none" stroke={c.ink} strokeWidth={2} /> : null}
                    <SvgText x={x + bw / 2} y={top - (col.selected ? 12 : 8)} fontSize={slot < 80 ? 12 : 14} fontFamily={F.bodyBold} fill={col.selected ? c.ink : c.ink2} textAnchor="middle">{col.total}</SvgText>
                    {col.note ? <SvgText x={x + bw / 2} y={top - (col.selected ? 12 : 8) - (slot < 80 ? 14 : 16)} fontSize={11} fontFamily={F.bodySemi} fill={c.ink3} textAnchor="middle">{col.note}</SvgText> : null}
                  </G>
                );
              })}
              {average != null && average > 0 ? (
                <G>
                  <Line x1={0} x2={w} y1={height - scale(average)} y2={height - scale(average)} stroke={c.ink2} strokeWidth={2} strokeDasharray="6 5" />
                  {averageLabel ? <G><Rect x={w - 8 - averageLabel.length * 6.6 - 8} y={height - scale(average) - 24} width={averageLabel.length * 6.6 + 16} height={20} rx={6} fill={c.paper} /><SvgText x={w - 8} y={height - scale(average) - 10} fontSize={12} fontFamily={F.bodyBold} fill={c.ink2} textAnchor="end">{averageLabel}</SvgText></G> : null}
                </G>
              ) : null}
              <Line x1={0} x2={w} y1={height - 1} y2={height - 1} stroke={c.line2} strokeWidth={2} />
            </Svg>
          );
        }}
      </Measured>
      <View style={{ flexDirection: 'row', paddingTop: 8 }}>
        {cols.map((col) => <Text key={col.key} style={{ flex: 1, textAlign: 'center', fontFamily: col.selected ? F.bodyBold : F.bodySemi, fontSize: 14, color: col.selected ? c.ink : c.ink2 }}>{col.label}</Text>)}
      </View>
    </View>
  );
}

export interface SignedBar { key: string; label: string; value: number; text: string; hatch?: boolean; color?: string }

/** Simple columns with their value on top; negative values hang below the line; hatched ones are partial periods. */
export function Columns({ bars, height = 120, color, negColor, label }: { bars: SignedBar[]; height?: number; color: string; negColor?: string; label: string }) {
  const { c } = useTheme();
  const raw = useId();
  const pos = Math.max(0, ...bars.map((b) => b.value)), neg = Math.min(0, ...bars.map((b) => b.value));
  const room = 20, plot = height - room - (neg < 0 ? room : 0);
  const span = Math.max(1, pos - neg);
  const zero = room + (pos / span) * plot;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Measured height={height}>
        {(w) => {
          const slot = w / Math.max(1, bars.length), bw = Math.min(72, slot - 12);
          return (
            <Svg width={w} height={height}>
              <Defs>{bars.map((b, i) => (b.hatch ? <HatchPattern key={i} id={`${sid(raw)}b${i}`} color={b.color ?? (b.value < 0 ? negColor ?? color : color)} /> : null))}</Defs>
              {bars.map((b, i) => {
                const fillColor = b.color ?? (b.value < 0 ? negColor ?? color : color);
                const h = Math.max(2, (Math.abs(b.value) / span) * plot);
                const x = slot * i + (slot - bw) / 2;
                const y = b.value >= 0 ? zero - h : zero;
                return (
                  <G key={b.key}>
                    <Path d={b.value >= 0 ? roundTop(x, y, bw, h, 6) : roundBottom(x, y, bw, h, 6)} fill={b.hatch ? `url(#${sid(raw)}b${i})` : fillColor} stroke={b.hatch ? fillColor : undefined} strokeWidth={b.hatch ? 1 : 0} />
                    <SvgText x={x + bw / 2} y={b.value >= 0 ? y - 5 : y + h + 14} fontSize={12} fontFamily={F.bodyBold} fill={c.ink} textAnchor="middle">{b.text}</SvgText>
                  </G>
                );
              })}
              <Line x1={0} x2={w} y1={zero} y2={zero} stroke={c.line2} strokeWidth={2} />
            </Svg>
          );
        }}
      </Measured>
      <View style={{ flexDirection: 'row', paddingTop: 6 }}>
        {bars.map((b) => <Text key={b.key} style={{ flex: 1, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 12, color: c.ink3 }}>{b.label}</Text>)}
      </View>
    </View>
  );
}

const roundBottom = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y} V${y + h - rr} Q${x} ${y + h} ${x + rr} ${y + h} H${x + w - rr} Q${x + w} ${y + h} ${x + w} ${y + h - rr} V${y} Z`;
};

/** The month so far as a rising line, against a straight dashed line from nothing to the forecast on the last day. */
export function PaceLine({ daily, days, forecast, label, endLabel }: { daily: number[]; days: number; forecast: number; label: string; endLabel: string }) {
  const { c } = useTheme();
  const H = 200;
  const max = Math.max(1, forecast, ...daily) * 1.08;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Measured height={H}>
        {(w) => {
          const x = (d: number) => (d / days) * (w - 4) + 2;
          const y = (v: number) => H - 2 - (v / max) * (H - 24);
          const pts = daily.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1)} ${y(v)}`).join(' ');
          return (
            <Svg width={w} height={H}>
              <Line x1={x(0)} y1={y(0)} x2={x(days)} y2={y(forecast)} stroke={c.ink3} strokeWidth={2} strokeDasharray="8 8" />
              <SvgText x={w - 4} y={14} fontSize={12} fontFamily={F.bodyBold} fill={c.ink2} textAnchor="end">{endLabel}</SvgText>
              {daily.length ? <Path d={`M${x(0)} ${y(0)} ${pts.replace(/^M/, 'L')}`} stroke={c.bar} strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
              {daily.length ? <Circle cx={x(daily.length)} cy={y(daily[daily.length - 1])} r={5} fill={c.bar} stroke={c.paper} strokeWidth={2} /> : null}
              <Line x1={0} x2={0} y1={0} y2={H} stroke={c.line2} strokeWidth={2} />
              <Line x1={0} x2={w} y1={H - 1} y2={H - 1} stroke={c.line2} strokeWidth={2} />
            </Svg>
          );
        }}
      </Measured>
    </View>
  );
}

/** An account's coverage of the date range: filled where statements cover it, hatched where none does. */
export function CoverageTrack({ from, to, covered, label }: { from: string; to: string; covered: { from: string; to: string }[]; label: string }) {
  const { c } = useTheme();
  const raw = useId();
  const t0 = Date.parse(from), span = Math.max(1, Date.parse(to) - t0 + 86400000);
  const pct = (iso: string, end = false) => ((Date.parse(iso) - t0 + (end ? 86400000 : 0)) / span) * 100;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ height: 8, borderRadius: 4, overflow: 'hidden' }}>
      <Svg width="100%" height={8}>
        <Defs><HatchPattern id={`${sid(raw)}t`} color={c.line2} gap={3} width={2} /></Defs>
        <Rect x={0} y={0} width="100%" height={8} fill={`url(#${sid(raw)}t)`} />
        {covered.map((iv, i) => <Rect key={i} x={`${pct(iv.from)}%`} y={0} width={`${Math.max(0.5, pct(iv.to, true) - pct(iv.from))}%`} height={8} fill={c.accent} rx={4} />)}
      </Svg>
    </View>
  );
}

/** A ranked bar per row: name, a navy bar against the largest, and the amount. */
export function BarRows({ rows, label }: { rows: { key: string; name: string; value: number; text: string }[]; label: string }) {
  const { c } = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ gap: 2 }}>
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 }}>
          <Text numberOfLines={1} style={{ width: '38%', maxWidth: 170, fontFamily: F.body, fontSize: 14, color: c.ink }}>{r.name}</Text>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.track, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: c.bar }} />
          </View>
          <Text style={[{ minWidth: 64, textAlign: 'right', fontFamily: F.bodyBold, fontSize: 14, color: c.ink }, TABULAR]}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** A colour key: a 10px rounded square and its name. */
export function Key({ color, children }: { color: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontFamily: F.body, fontSize: 13, color: c.ink2 }}>{children}</Text>
    </View>
  );
}
