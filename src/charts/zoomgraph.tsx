import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { categoryLabel } from '@/core/categories';
import { LEVEL_NAMES, graphChildren, graphFilter, graphRoots, isLeaf } from '@/core/graph';
import type { GNode, Seg } from '@/core/graph';
import { dollars } from '@/core/queries';
import type { Ctx, Filter } from '@/core/queries';
import { F, LIGHT, R, S } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Button, T, useWide } from '@/theme/ui';

interface Props { ctx: Ctx; scope: Filter['scope']; colorOf: (category: string) => string; onOpen?: (f: Filter) => void }

const GAP = 44, MIN_H = 30, SEP = 4, MAX_H = 440, ITEM_H = 34;

/** labels on a coloured block: a fixed dark or white, chosen by the fill, never by the theme's own ink */
const darkText = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
};

function colorFor(n: GNode, colorOf: Props['colorOf'], C: Palette): string {
  const cat = n.path.find((s) => s.level === 'category');
  if (cat) return colorOf(cat.key);
  return n.level === 'kind' && n.key !== 'spend' ? C.ink3 : C.bar;
}

const crumb = (path: Seg[], nodes: GNode[]) => path.map((s, i) => ({ s, label: nodes[i]?.label ?? s.key }));

export function ZoomGraph(p: Props) {
  const wide = useWide();
  return wide ? <Columns {...p} /> : <Outline {...p} />;
}

// ---------------------------------------------------------------------------
// Wide screens: zoom columns with ribbons from the selected node to its children.
// ---------------------------------------------------------------------------
function Columns({ ctx, scope, colorOf, onOpen }: Props) {
  const C = useColors();
  const { width: winW } = useWindowDimensions();
  const colW = Math.max(112, Math.min(170, Math.floor((winW - 200 - 48 - 32 - 5 * GAP) / 6)));
  const scroller = useRef<ScrollViewInstance>(null);
  const roots = useMemo(() => graphRoots(ctx, scope), [ctx, scope]);
  const [path, setPath] = useState<Seg[]>(() => (roots[0] ? roots[0].path : []));
  const sel = useMemo(() => (path.length ? path : roots[0]?.path ?? []), [path, roots]);

  const cols = useMemo(() => {
    const out: GNode[][] = [roots];
    for (let k = 1; k <= sel.length; k++) {
      const kids = graphChildren(ctx, sel.slice(0, k), scope);
      if (!kids.length) break;
      out.push(kids);
    }
    return out;
  }, [ctx, scope, roots, sel]);

  const layout = cols.map((col) => {
    const leafCol = col.every(isLeaf) && col[0]?.level === 'item';
    const total = col.reduce((s, n) => s + Math.abs(n.cents), 0) || 1;
    const avail = MAX_H - SEP * (col.length - 1);
    let y = 0;
    const blocks = col.map((n) => {
      const h = leafCol ? ITEM_H : Math.max(MIN_H, (Math.abs(n.cents) / total) * avail);
      const b = { n, y, h }; y += h + SEP; return b;
    });
    return { blocks, height: Math.max(0, y - SEP), total, scaled: !leafCol };
  });
  useEffect(() => { scroller.current?.scrollToEnd({ animated: true }); }, [cols.length]);
  const height = Math.max(120, ...layout.map((l) => l.height));
  const width = cols.length * colW + (cols.length - 1) * GAP;

  const selectedNodes = sel.map((s, i) => cols[i]?.find((n) => n.key === s.key)).filter(Boolean) as GNode[];
  const current = selectedNodes[selectedNodes.length - 1];
  const select = (n: GNode, colIdx: number) => {
    const same = sel.length === colIdx + 1 && sel[colIdx].key === n.key;
    setPath(same ? n.path.slice(0, colIdx) : n.path);
  };
  const colIdxOfCurrent = current ? sel.length - 1 : 0;

  return (
    <View style={{ gap: S.md }}>
      <Detail nodes={selectedNodes} onJump={(i) => setPath(sel.slice(0, i + 1))} onClear={() => setPath([])} onOpen={onOpen ? () => current && onOpen(graphFilter(current.path, scope)) : undefined} current={current} colIdx={colIdxOfCurrent} />
      <ScrollView horizontal showsHorizontalScrollIndicator ref={scroller}>
        <View style={{ width, minWidth: '100%' }}>
          <View style={{ flexDirection: 'row', marginBottom: S.xs }}>
            {cols.map((col, k) => <View key={k} style={{ width: colW, marginRight: k < cols.length - 1 ? GAP : 0 }}><T size={12} bold tone="ink3">{LEVEL_NAMES[col[0].level]}</T></View>)}
          </View>
          <View style={{ height, width }}>
            <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
              {layout.slice(0, -1).map((lay, k) => {
                const sk = lay.blocks.find((b) => sel[k] && b.n.key === sel[k].key);
                if (!sk) return null;
                const next = layout[k + 1];
                const x0 = k * (colW + GAP) + colW, x1 = x0 + GAP, xm = (x0 + x1) / 2;
                let acc = 0;
                return next.blocks.map((cb) => {
                  const share = Math.abs(cb.n.cents) / next.total;
                  const ya = sk.y + (acc * sk.h), yb = ya + share * sk.h; acc += share;
                  const d = `M${x0} ${ya} C${xm} ${ya} ${xm} ${cb.y} ${x1} ${cb.y} L${x1} ${cb.y + cb.h} C${xm} ${cb.y + cb.h} ${xm} ${yb} ${x0} ${yb} Z`;
                  return <Path key={`${k}${cb.n.id}`} d={d} fill={colorFor(cb.n, colorOf, C)} opacity={0.22} />;
                });
              })}
            </Svg>
            {layout.map((lay, k) => lay.blocks.map(({ n, y, h }) => {
              const picked = sel[k]?.key === n.key;
              const dim = sel[k] && !picked;
              const col = colorFor(n, colorOf, C);
              const fg = n.hatch ? C.ink : darkText(col) ? LIGHT.ink : '#FFFFFF';
              return (
                <Pressable key={n.id} accessibilityRole="button" aria-selected={picked} accessibilityLabel={`${n.label}, ${dollars(n.cents)}${n.hatch ? ', no item detail' : ''}`}
                  onPress={() => (isLeaf(n) ? undefined : select(n, k))}
                  style={{ position: 'absolute', left: k * (colW + GAP), top: y, width: colW, height: h, borderRadius: 6, paddingHorizontal: 8, justifyContent: 'center', backgroundColor: n.hatch ? C.paper : col, borderWidth: picked ? 2 : n.hatch ? 1.5 : 0, borderColor: picked ? C.ink : col, borderStyle: n.hatch && !picked ? 'dashed' : 'solid', opacity: dim ? 0.55 : 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4 }}>
                    <T size={12} bold numberOfLines={1} style={{ color: fg, flex: 1 }}>{n.label}</T>
                    {h >= 26 ? <T size={12} numberOfLines={1} style={{ color: fg }}>{dollars(n.cents, { decimals: false })}</T> : null}
                  </View>
                  {n.partial ? <T size={10} style={{ color: fg }}>partial month</T> : n.countsAs ? <T size={10} style={{ color: fg }}>counts as {n.countsAs}</T> : null}
                </Pressable>
              );
            }))}
          </View>
        </View>
      </ScrollView>
      <T size={12} tone="ink3">Block heights are to scale in every column except Item. Dashed blocks have no item detail yet.</T>
    </View>
  );
}

function Detail({ nodes, onJump, onClear, onOpen, current, colIdx }: { nodes: GNode[]; onJump: (i: number) => void; onClear: () => void; onOpen?: () => void; current?: GNode; colIdx: number }) {
  const C = useColors();
  return (
    <View style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md, gap: S.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Pressable accessibilityRole="button" onPress={onClear} style={{ minHeight: 36, justifyContent: 'center', paddingRight: 6 }}><T size={13} tone="ink3">All years</T></Pressable>
        {crumb(nodes.map((n) => n.path[n.path.length - 1]), nodes).map((c, i) => (
          <Pressable key={i} accessibilityRole="button" onPress={() => onJump(i)} style={{ minHeight: 36, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' }}>
            <T size={13} tone="ink3">{'/ '}</T><T size={13} bold={i === nodes.length - 1}>{c.label}</T>
          </Pressable>
        ))}
      </View>
      {current ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: S.sm }}>
          <View>
            <T style={{ fontFamily: F.display, fontSize: 24, lineHeight: 30 }}>{dollars(current.cents)}</T>
            <T size={12} tone="ink3">{current.count} transaction{current.count === 1 ? '' : 's'}{colIdx > 0 && current.share ? `, ${Math.round(current.share * 100)}% of ${nodes[colIdx - 1]?.label ?? 'parent'}` : ''}</T>
          </View>
          {onOpen ? <Button small kind="outline" label="See transactions" onPress={onOpen} /> : null}
        </View>
      ) : <T size={13} tone="ink2">Pick a year to open its months.</T>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Phone: indented outline, one tap opens the next level, bars show share of parent.
// ---------------------------------------------------------------------------
function Outline({ ctx, scope, colorOf, onOpen }: Props) {
  const C = useColors();
  const roots = useMemo(() => graphRoots(ctx, scope), [ctx, scope]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(roots[0] ? [roots[0].id] : []));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <View style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.sm }}>
      {roots.map((n) => <OutlineRow key={n.id} n={n} depth={0} open={open} toggle={toggle} ctx={ctx} scope={scope} colorOf={colorOf} onOpen={onOpen} />)}
      <T size={12} tone="ink3" style={{ padding: S.sm }}>Bars show each row’s share of the row above it. Dashed bars have no item detail yet.</T>
    </View>
  );
}

function OutlineRow({ n, depth, open, toggle, ctx, scope, colorOf, onOpen }: { n: GNode; depth: number; open: Set<string>; toggle: (id: string) => void; ctx: Ctx; scope: Filter['scope']; colorOf: Props['colorOf']; onOpen?: (f: Filter) => void }) {
  const C = useColors();
  const isOpen = open.has(n.id);
  const leaf = isLeaf(n);
  const kids = useMemo(() => (isOpen && !leaf ? graphChildren(ctx, n.path, scope) : []), [isOpen, leaf, ctx, n.path, scope]);
  const col = colorFor(n, colorOf, C);
  return (
    <View>
      <Pressable accessibilityRole="button" aria-expanded={leaf ? undefined : isOpen} accessibilityLabel={`${n.label}, ${dollars(n.cents)}`}
        onPress={() => (leaf ? undefined : toggle(n.id))} onLongPress={() => onOpen?.(graphFilter(n.path, scope))}
        style={{ minHeight: 52, paddingLeft: 4 + depth * 16, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <T size={16} tone="ink3" style={{ width: 16, textAlign: 'center' }}>{leaf ? '' : isOpen ? '−' : '+'}</T>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
            <T size={14} bold={depth < 2} numberOfLines={1} style={{ flex: 1 }}>{n.label}</T>
            <T size={14} bold>{dollars(n.cents, { decimals: false })}</T>
          </View>
          <View style={{ height: 6, backgroundColor: C.line, borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(2, n.share * 100)}%`, height: '100%', backgroundColor: n.hatch ? C.paper : col, borderWidth: n.hatch ? 1 : 0, borderColor: col, borderStyle: n.hatch ? 'dashed' : 'solid' }} />
          </View>
          {n.partial || n.countsAs || n.hatch ? <T size={11} tone="ink3">{n.partial ? 'Partial month' : n.countsAs ? `Counts as ${n.countsAs}` : 'No item detail yet'}</T> : null}
        </View>
      </Pressable>
      {isOpen && onOpen && !leaf && depth >= 2 ? (
        <View style={{ paddingLeft: 24 + depth * 16, paddingBottom: 4 }}><Button small kind="ghost" label="See transactions" onPress={() => onOpen(graphFilter(n.path, scope))} style={{ alignSelf: 'flex-start' }} /></View>
      ) : null}
      {kids.map((k) => <OutlineRow key={k.id} n={k} depth={depth + 1} open={open} toggle={toggle} ctx={ctx} scope={scope} colorOf={colorOf} onOpen={onOpen} />)}
    </View>
  );
}

export { categoryLabel };
