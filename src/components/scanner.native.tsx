import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';

import { FULL_FRAME, isValidQuad, moveCorner, nearestCorner } from '@/core/scan';
import type { Pt, Quad, ScanMode } from '@/core/scan';
import { previewScan } from '@/data/scan';
import type { Shot } from '@/data/scan';
import { S } from '@/theme/tokens';
import { useColors } from '@/theme/theme';
import { Button, Segmented, T } from '@/theme/ui';

const MODES: { value: ScanMode; label: string }[] = [{ value: 'gray', label: 'Black and white' }, { value: 'color', label: 'Colour' }, { value: 'original', label: 'As taken' }];
const GOOD = '#1fa971', BAD = '#c0392b';
/** how close a finger must land to a corner to take it, as a share of the photo's width: generous, because a fingertip is not a mouse pointer */
const GRAB = 0.14;

/**
 * The person's chance to check the scan of a photo before it is used, like a document scanner, for the phone and tablet builds: the app
 * suggests where the paper is, the four corners are dragged with a finger to fix it, and a preview shows the straightened, cleaned-up result.
 * Nothing is changed until "Use this scan". The web version (scanner.tsx) does the same with page elements.
 */
export function ScanReview({ shot, busy, error, onUse, onOriginal, onDiscard }: {
  shot: Shot; busy: boolean; error?: string;
  onUse: (quad: Quad, mode: ScanMode, turns: number) => void; onOriginal: () => void; onDiscard: () => void;
}) {
  const C = useColors();
  const [quad, setQuad] = useState<Quad>(shot.suggestion.quad);
  const [mode, setMode] = useState<ScanMode>('gray');
  const [turns, setTurns] = useState(0);
  const [drag, setDrag] = useState(-1);
  const [width, setWidth] = useState(0);
  const [result, setResult] = useState('');
  const [failed, setFailed] = useState('');
  const dragging = drag >= 0;
  const valid = isValidQuad(quad);
  const aspect = shot.width / shot.height;
  const height = width / aspect;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the gesture handlers live as long as the screen, so they read the newest values from this holder (kept up to date after every render)
  const [g] = useState(() => ({ quad, busy, width, height, aspect, index: -1, from: { x: 0, y: 0 } as Pt }));
  useEffect(() => { Object.assign(g, { quad, busy, width, height, aspect }); });
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: (e) => {
      if (g.busy || !g.width) return false;
      const i = nearestCorner(g.quad, { x: e.nativeEvent.locationX / g.width, y: e.nativeEvent.locationY / g.height }, g.aspect, GRAB);
      if (i < 0) return false;
      g.index = i; g.from = g.quad[i];
      return true;
    },
    onPanResponderGrant: () => setDrag(g.index),
    onPanResponderMove: (_e, d) => {
      if (g.index >= 0 && g.width) setQuad(moveCorner(g.quad, g.index, { x: g.from.x + d.dx / g.width, y: g.from.y + d.dy / g.height }));
    },
    onPanResponderRelease: () => { g.index = -1; setDrag(-1); },
    onPanResponderTerminate: () => { g.index = -1; setDrag(-1); },
    // a scrolling page must not take the corner away from the finger
    onPanResponderTerminationRequest: () => false,
  }));

  // the preview is redrawn when a corner is let go, never while one is being dragged
  useEffect(() => {
    if (dragging || !valid) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { setResult(previewScan(shot, quad, mode, turns)); setFailed(''); } catch (e) { setFailed((e as Error).message); }
    }, 30);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [shot, quad, mode, turns, dragging, valid]);

  const px = (p: Pt) => `${p.x * width} ${p.y * height}`;
  const outline = valid ? GOOD : BAD;

  return (
    <View style={{ gap: S.sm }}>
      <T size={13} tone="ink2">
        {shot.suggestion.confident ? 'The app found the paper. Drag the corners if the outline is off.' : 'The paper did not stand out from what it lies on, so the whole photo is outlined. Drag each corner to the corner of the receipt.'}
        {' '}The scan is straightened, the light is evened out and the print is darkened.
      </T>
      <T size={12} tone="ink3">Photo and crop</T>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ width: '100%', maxWidth: 560, alignSelf: 'center', aspectRatio: aspect, borderWidth: 1, borderColor: C.line }}
        {...pan.panHandlers}
      >
        <Image source={{ uri: shot.preview }} contentFit="fill" style={{ width: '100%', height: '100%' }} pointerEvents="none" accessibilityLabel="The photo" />
        {width > 0 ? (
          <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
            <Path d={`M0 0H${width}V${height}H0Z M${quad.map(px).join('L')}Z`} fill="rgba(0,0,0,0.45)" fillRule="evenodd" />
            <Polygon points={quad.map((p) => `${p.x * width},${p.y * height}`).join(' ')} fill="none" stroke={outline} strokeWidth={2} />
            {quad.map((p, i) => <Circle key={i} cx={p.x * width} cy={p.y * height} r={13} fill={i === drag ? GOOD : 'rgba(255,255,255,0.9)'} stroke={outline} strokeWidth={3} />)}
          </Svg>
        ) : null}
      </View>

      <T size={12} tone="ink3">Result</T>
      {!valid ? <T size={13} tone="bad">These corners do not make a four-sided shape inside the photo. Move a corner, or press Whole photo.</T>
        : failed ? <T size={13} tone="bad">{failed}</T>
        : result ? <Image source={{ uri: result }} contentFit="contain" style={{ width: '100%', maxWidth: 560, height: 360, alignSelf: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' }} accessibilityLabel="The scan" />
        : <T size={13} tone="ink2">Preparing the preview</T>}

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
