// JPEG bytes <-> the RGBA pixel arrays core/scan.ts works on, for phone builds (the web version uses a canvas for this). Pure JavaScript, so it
// runs the same in the app and in the tests.
import jpeg from 'jpeg-js';

import type { Img } from '@/core/scan';
import { toBase64 } from '@/core/sha256';

/** Decode a JPEG to RGBA pixels. Throws on anything that is not a readable JPEG. */
export function decodeJpeg(bytes: Uint8Array): Img {
  const r = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.byteLength) };
}

/**
 * Encode RGBA pixels as a JPEG (quality 1 to 100). jpeg-js ends its encoder with `Buffer.from(bytes)`, and a phone's JavaScript engine has no
 * Buffer, so a stand-in that only does that one thing exists while the encoder runs and is removed again.
 */
export function encodeJpeg(img: Img, quality = 90): Uint8Array {
  const g = globalThis as { Buffer?: unknown };
  const lent = !g.Buffer;
  if (lent) g.Buffer = { from: (a: ArrayLike<number>) => Uint8Array.from(a as ArrayLike<number>) };
  try {
    return new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality).data);
  } finally {
    if (lent) delete g.Buffer;
  }
}

/** A `data:` URL of the picture, for showing a small preview. */
export const jpegDataUrl = (img: Img, quality = 80): string => `data:image/jpeg;base64,${toBase64(encodeJpeg(img, quality))}`;
