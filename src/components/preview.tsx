import { createElement, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Image, Platform, ScrollView, View, useWindowDimensions } from 'react-native';

import { toBase64 } from '@/core/sha256';
import { C, R, S } from '@/theme/tokens';
import { Button, Chip, T } from '@/theme/ui';

export interface PreviewFile { name: string; type: string; bytes: Uint8Array }

const ZOOMS = [1, 2, 3] as const;

/**
 * The original file beside its reading, so a person can compare the two and fix what is wrong. Images can be zoomed (a receipt photo is
 * tall and narrow, and digits are small at "fit"). A PDF is shown by the browser's own viewer on the web; on a phone there is no PDF
 * viewer in the app, so it says so.
 */
export function FilePreview({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const isWeb = Platform.OS === 'web';
  const isPdf = file.type === 'application/pdf';
  const { height } = useWindowDimensions();
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [width, setWidth] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null);

  const uri = useMemo(() => {
    if (isWeb) return URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.type }));
    return isPdf ? null : `data:${file.type};base64,${toBase64(file.bytes)}`;
  }, [file.bytes, file.type, isWeb, isPdf]);
  useEffect(() => () => { if (isWeb && uri) URL.revokeObjectURL(uri); }, [isWeb, uri]);
  useEffect(() => { if (uri && !isPdf) Image.getSize(uri, (w, h) => setAspect(w / h), () => {}); }, [uri, isPdf]);

  const box = Math.max(420, Math.round(height * 0.8));
  let body: ReactElement;
  if (!uri) body = <T size={13} tone="ink2">This PDF can be read here but not shown inside the phone app. Open it from the Files app to compare.</T>;
  else if (isPdf) body = createElement('iframe', { src: uri, title: file.name, style: { width: '100%', height: box, border: 0, borderRadius: 8, background: '#fff' } });
  else {
    const w = Math.max(width, 1) * zoom;
    body = (
      <ScrollView style={{ height: box }} nestedScrollEnabled>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
          <Image source={{ uri }} accessibilityLabel={`Original file ${file.name}`} resizeMode="contain" style={{ width: w, height: aspect ? w / aspect : box }} />
        </ScrollView>
      </ScrollView>
    );
  }

  return (
    <View style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.lg, gap: S.sm }} onLayout={(e) => setWidth(e.nativeEvent.layout.width - S.lg * 2)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
        <View style={{ flex: 1 }}><T size={13} bold numberOfLines={1}>Original: {file.name}</T></View>
        <Button small kind="ghost" label="Close" onPress={onClose} />
      </View>
      {!isPdf && uri ? (
        <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {ZOOMS.map((z) => <Chip key={z} label={z === 1 ? 'Fit' : `${z}x`} on={zoom === z} onPress={() => setZoom(z)} />)}
          {isWeb ? <Button small kind="ghost" label="Open full size" onPress={() => window.open(uri, '_blank')} /> : null}
        </View>
      ) : null}
      {body}
    </View>
  );
}
