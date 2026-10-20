import { createElement, useState } from 'react';
import { TextInput, View } from 'react-native';

import { REDACT_LABEL, countByReason, drawnBox, parseHideWords, removeDrawn, setReason, toggleBox } from '@/core/redact';
import type { RedactBox } from '@/core/redact';
import type { Scan } from '@/data/redact';
import { C, F, R, S } from '@/theme/tokens';
import { Button, Chip, T } from '@/theme/ui';

type Pt = { x: number; y: number };

/**
 * The person's chance to check what will be blacked out of a statement before it is read or stored. Every page is shown with the boxes the app
 * found; a box is clicked to switch it off or on, a new one is drawn by dragging across the page, and a list of words to always hide can be
 * searched for again. Nothing is changed in the file until "Use these redactions" is pressed. Web only: it draws with ordinary page elements.
 */
export function RedactReview({ scan, boxes, hideText, busy, error, onBoxes, onSearch, onApprove, onSkip, onDiscard }: {
  scan: Scan; boxes: RedactBox[]; hideText: string; busy: boolean; error?: string;
  onBoxes: (next: RedactBox[]) => void; onSearch: (words: string[], text: string) => void; onApprove: () => void; onSkip: () => void; onDiscard: () => void;
}) {
  const [text, setText] = useState(hideText);
  const [drag, setDrag] = useState<{ page: number; a: Pt; b: Pt } | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const on = boxes.filter((b) => b.on).length;
  const drawn = boxes.filter((b) => b.reason === 'drawn');

  const point = (e: any): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  return (
    <View style={{ gap: S.sm }}>
      <T size={13} tone="ink2">Check what will be blacked out before this statement is read or stored. Red boxes are covered in the copy that is used; the original is not kept. Click a box to switch it off or on. Drag across a page to cover something it missed. Account and card numbers keep their last four digits so the statement can still be matched to its account.</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {countByReason(boxes).map((c) => <Chip key={c.reason} label={`${REDACT_LABEL[c.reason]}: ${c.on} of ${c.total}`} on={c.on > 0} onPress={() => onBoxes(setReason(boxes, c.reason, c.on < c.total))} />)}
        {!boxes.length ? <T size={13} tone="ink2">Nothing looked sensitive. Draw a box over anything you want covered.</T> : null}
      </View>

      <View style={{ gap: 2 }}>
        <T size={12} tone="ink3">Words to always hide, such as your name, street or employer. One per line or separated by commas. Kept on this device only.</T>
        <TextInput value={text} onChangeText={setText} multiline editable={!busy} placeholder="John Q Public, 123 Main St" placeholderTextColor={C.ink3} accessibilityLabel="Words to always hide"
          style={{ minHeight: 56, borderRadius: R.md, backgroundColor: C.ground, paddingHorizontal: S.md, paddingTop: S.sm, fontFamily: F.body, fontSize: 14, color: C.ink, textAlignVertical: 'top' }} />
        <View style={{ flexDirection: 'row' }}><Button small kind="outline" label="Search again with these words" disabled={busy} onPress={() => onSearch(parseHideWords(text), text)} /></View>
      </View>

      {scan.pages.map((p, i) => (
        <View key={i} style={{ gap: 2 }}>
          <T size={12} tone="ink3">Page {i + 1} of {scan.pages.length}</T>
          {createElement('div', {
            style: { position: 'relative', width: '100%', maxWidth: 760, userSelect: 'none', touchAction: 'none', cursor: 'crosshair', border: '1px solid #ccc' },
            onPointerDown: (e: any) => { if (busy) return; e.currentTarget.setPointerCapture?.(e.pointerId); const a = point(e); setDrag({ page: i, a, b: a }); },
            onPointerMove: (e: any) => { if (drag && drag.page === i) setDrag({ ...drag, b: point(e) }); },
            onPointerUp: () => {
              if (drag && drag.page === i && Math.abs(drag.a.x - drag.b.x) > 0.01 && Math.abs(drag.a.y - drag.b.y) > 0.004) onBoxes([...boxes, drawnBox(i, drag.a, drag.b, drawn.length + Date.now() % 100000)]);
              setDrag(null);
            },
          },
          createElement('img', { src: p.preview, alt: `Page ${i + 1}`, draggable: false, style: { width: '100%', display: 'block', pointerEvents: 'none' } }),
          ...boxes.filter((b) => b.page === i).map((b) => createElement('div', {
            key: b.id,
            title: `${REDACT_LABEL[b.reason]}${b.text ? `: ${b.text}` : ''} (click to switch ${b.on ? 'off' : 'on'})`,
            onPointerDown: (e: any) => e.stopPropagation(),
            onClick: () => onBoxes(toggleBox(boxes, b.id)),
            style: { position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, boxSizing: 'border-box', cursor: 'pointer',
              background: b.on ? 'rgba(0,0,0,0.9)' : 'rgba(192,57,43,0.08)', outline: b.on ? '2px solid #c0392b' : '2px dashed #c0392b' },
          })),
          drag && drag.page === i ? createElement('div', { key: 'drag', style: { position: 'absolute', left: `${Math.min(drag.a.x, drag.b.x) * 100}%`, top: `${Math.min(drag.a.y, drag.b.y) * 100}%`, width: `${Math.abs(drag.a.x - drag.b.x) * 100}%`, height: `${Math.abs(drag.a.y - drag.b.y) * 100}%`, background: 'rgba(0,0,0,0.5)', outline: '2px solid #c0392b' } }) : null)}
        </View>
      ))}

      {error ? <T size={13} tone="bad">{error}</T> : null}
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button label={busy ? 'Applying' : `Use these redactions (${on} box${on === 1 ? '' : 'es'})`} disabled={busy} onPress={onApprove} />
        {drawn.length ? <Button small kind="ghost" label="Remove the boxes I drew" disabled={busy} onPress={() => onBoxes(drawn.reduce((acc, d) => removeDrawn(acc, d.id), boxes))} /> : null}
        <Button small kind="ghost" label="Discard this file" disabled={busy} onPress={onDiscard} />
      </View>
      {confirmSkip ? (
        <View style={{ gap: S.xs, backgroundColor: C.ground, borderRadius: R.md, padding: S.md }}>
          <T size={13} tone="bad" bold>Read it without redacting?</T>
          <T size={13} tone="ink2">The whole original, with every number and address on it, is sent to the reader and kept in your private storage.</T>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button small kind="outline" label="Yes, read the original" disabled={busy} onPress={onSkip} />
            <Button small kind="ghost" label="No, go back" onPress={() => setConfirmSkip(false)} />
          </View>
        </View>
      ) : <View style={{ flexDirection: 'row' }}><Button small kind="ghost" label="Read without redacting" disabled={busy} onPress={() => setConfirmSkip(true)} /></View>}
    </View>
  );
}
