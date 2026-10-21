import { createElement, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { FULL_FRAME, isValidQuad, moveCorner, nearestCorner } from '@/core/scan';
import type { Pt, Quad, ScanMode } from '@/core/scan';
import { previewScan } from '@/data/scan';
import type { Shot } from '@/data/scan';
import { C, S } from '@/theme/tokens';
import { Button, Segmented, T } from '@/theme/ui';

const MODES: { value: ScanMode; label: string }[] = [{ value: 'gray', label: 'Black and white' }, { value: 'color', label: 'Colour' }, { value: 'original', label: 'As taken' }];

/**
 * The person's chance to check the scan of a photo before it is used, like a document scanner: the app suggests where the paper is, the four
 * corners can be dragged to fix it, and a preview shows the straightened, cleaned-up result. Nothing is changed until "Use this scan". Web only:
 * it draws with ordinary page elements.
 */
export function ScanReview({ shot, busy, error, onUse, onOriginal, onDiscard }: {
  shot: Shot; busy: boolean; error?: string;
  onUse: (quad: Quad, mode: ScanMode, turns: number) => void; onOriginal: () => void; onDiscard: () => void;
}) {
  const [quad, setQuad] = useState<Quad>(shot.suggestion.quad);
  const [mode, setMode] = useState<ScanMode>('gray');
  const [turns, setTurns] = useState(0);
  const [drag, setDrag] = useState<number>(-1);
  const [result, setResult] = useState('');
  const [failed, setFailed] = useState('');
  const dragging = drag >= 0;
  const valid = isValidQuad(quad);
  const aspect = shot.width / shot.height;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the preview is redrawn when a corner is let go, never while one is being dragged
  useEffect(() => {
    if (dragging || !valid) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { setResult(previewScan(shot, quad, mode, turns)); setFailed(''); } catch (e) { setFailed((e as Error).message); }
    }, 30);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [shot, quad, mode, turns, dragging, valid]);

  const point = (e: any): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const pct = (v: number) => `${v * 100}%`;
  const path = `M0 0H1V1H0Z M${quad.map((p) => `${p.x} ${p.y}`).join('L')}Z`;

  return (
    <View style={{ gap: S.sm }}>
      <T size={13} tone="ink2">
        {shot.suggestion.confident ? 'The app found the paper. Drag the corners if the outline is off.' : 'The paper did not stand out from what it lies on, so the whole photo is outlined. Drag each corner to the corner of the receipt.'}
        {' '}The scan is straightened, the light is evened out and the print is darkened.
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 260, gap: 2 }}>
          <T size={12} tone="ink3">Photo and crop</T>
          {createElement('div', {
            style: { position: 'relative', width: '100%', maxWidth: 440, userSelect: 'none', touchAction: 'none', border: '1px solid #ccc', cursor: dragging ? 'grabbing' : 'default' },
            onPointerDown: (e: any) => {
              if (busy) return;
              const at = point(e); const i = nearestCorner(quad, at, aspect, 0.1);
              if (i < 0) return;
              e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(i); setQuad(moveCorner(quad, i, at));
            },
            onPointerMove: (e: any) => { if (dragging) setQuad((q) => moveCorner(q, drag, point(e))); },
            onPointerUp: () => setDrag(-1),
            onPointerCancel: () => setDrag(-1),
          },
          createElement('img', { src: shot.preview, alt: 'The photo', draggable: false, style: { width: '100%', display: 'block', pointerEvents: 'none' } }),
          createElement('svg', { viewBox: '0 0 1 1', preserveAspectRatio: 'none', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } },
            createElement('path', { d: path, fill: 'rgba(0,0,0,0.45)', fillRule: 'evenodd' }),
            createElement('polygon', { points: quad.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: valid ? '#1fa971' : '#c0392b', strokeWidth: 0.006, vectorEffect: 'non-scaling-stroke' })),
          ...quad.map((p, i) => createElement('div', {
            key: i, title: 'Drag to move this corner',
            style: { position: 'absolute', left: pct(p.x), top: pct(p.y), width: 26, height: 26, marginLeft: -13, marginTop: -13, borderRadius: 13, boxSizing: 'border-box', background: i === drag ? '#1fa971' : 'rgba(255,255,255,0.9)', border: `3px solid ${valid ? '#1fa971' : '#c0392b'}`, cursor: 'grab', pointerEvents: 'none' },
          })))}
        </View>
        <View style={{ flex: 1, minWidth: 260, gap: 2 }}>
          <T size={12} tone="ink3">Result</T>
          {!valid ? <T size={13} tone="bad">These corners do not make a four-sided shape inside the photo. Move a corner, or press Whole photo.</T> : failed ? <T size={13} tone="bad">{failed}</T> : result ? createElement('img', { src: result, alt: 'The scan', style: { width: '100%', maxWidth: 440, display: 'block', border: '1px solid #ccc', background: '#fff' } }) : <T size={13} tone="ink2">Preparing the preview</T>}
        </View>
      </View>

      <Segmented value={mode} options={MODES} onChange={setMode} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        <Button small kind="outline" label="Turn left" disabled={busy} onPress={() => setTurns((turns + 3) % 4)} />
        <Button small kind="outline" label="Turn right" disabled={busy} onPress={() => setTurns((turns + 1) % 4)} />
        <Button small kind="ghost" label="Back to the suggestion" disabled={busy} onPress={() => setQuad(shot.suggestion.quad)} />
        <Button small kind="ghost" label="Whole photo" disabled={busy} onPress={() => setQuad(FULL_FRAME.map((p) => ({ ...p })) as Quad)} />
      </View>
      {error ? <T size={13} tone="bad">{error}</T> : null}
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button label={busy ? 'Saving the scan' : 'Use this scan'} disabled={busy || !valid} onPress={() => onUse(quad, mode, turns)} />
        <Button small kind="outline" label="Use the photo as taken" disabled={busy} onPress={onOriginal} />
        <Button small kind="ghost" label="Discard this photo" disabled={busy} onPress={onDiscard} />
      </View>
      <View style={{ height: 1, backgroundColor: C.line }} />
    </View>
  );
}
