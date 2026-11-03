// Scanning a photo of a receipt, for the iPhone, iPad and Android builds: the photo is turned upright and shrunk with expo-image-manipulator,
// decoded to pixels, and core/scan.ts finds the paper, cuts it out flat and cleans up the light. Everything runs on the device; the photo goes
// nowhere until the person uses the scan. (The web version is scan.web.ts; scan.ts is the stand-in for anything else.)
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';

import { findDocument, scanImage } from '@/core/scan';
import type { Img, Quad, ScanMode } from '@/core/scan';
import { decodeJpeg, encodeJpeg, jpegDataUrl } from './jpegimg';
import type { Shot } from './scan';

export const scanSupported = true;

/**
 * The longest side of the picture the scan works from. A phone photo is 12 megapixels or more, which is slow to decode in JavaScript and holds
 * about 50 MB; this size still reads clearly (a receipt 30 cm long is about 170 dpi) and keeps the crop screen quick.
 */
const MAX_SIDE = 2000;
const PREVIEW_SIDE = 900;
const RESULT_PREVIEW_SIDE = 700;
const QUALITY = 90;

/** Let the screen draw (a "busy" state, a spinner) before JavaScript work that holds the thread for a moment. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

/** Shrink to MAX_SIDE and turn upright (the photo's own EXIF rotation is applied), as a JPEG on disk. */
async function upright(uri: string): Promise<string> {
  const whole = await ImageManipulator.manipulate(uri).renderAsync();
  const k = Math.min(1, MAX_SIDE / Math.max(whole.width, whole.height));
  const ctx = ImageManipulator.manipulate(uri);
  const out = await (k < 1 ? ctx.resize(whole.width >= whole.height ? { width: Math.round(whole.width * k) } : { height: Math.round(whole.height * k) }) : ctx).renderAsync();
  return (await out.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 })).uri;
}

export async function loadShot(bytes: Uint8Array, _type: string): Promise<Shot> {
  const src = new File(Paths.cache, `scan-in-${Date.now()}.jpg`);
  src.create({ overwrite: true });
  await src.write(bytes);
  let flat: File | null = null;
  try {
    flat = new File(await upright(src.uri));
    await breathe();
    const img = decodeJpeg(await flat.bytes());
    const small = scaled(img, PREVIEW_SIDE);
    return { width: img.width, height: img.height, preview: jpegDataUrl(small, 80), suggestion: findDocument(img), held: img };
  } finally {
    try { src.delete(); } catch { /* the cache is cleared by the system anyway */ }
    try { flat?.delete(); } catch { /* same */ }
  }
}

/** A copy no larger than `maxSide` on its longest side (nearest pixel: it is only for looking at). */
function scaled(img: Img, maxSide: number): Img {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (k === 1) return img;
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const so = (sy * img.width + Math.min(img.width - 1, Math.floor(x / k))) * 4, o = (y * w + x) * 4;
      data[o] = img.data[so]; data[o + 1] = img.data[so + 1]; data[o + 2] = img.data[so + 2]; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export function previewScan(shot: Shot, quad: Quad, mode: ScanMode, turns: number): string {
  return jpegDataUrl(scanImage(shot.held as Img, quad, mode, turns, RESULT_PREVIEW_SIDE), 80);
}

export async function finishScan(shot: Shot, quad: Quad, mode: ScanMode, turns: number): Promise<{ bytes: Uint8Array; type: string }> {
  await breathe();
  return { bytes: encodeJpeg(scanImage(shot.held as Img, quad, mode, turns), QUALITY), type: 'image/jpeg' };
}

export function discardShot(shot: Shot): void {
  shot.held = undefined;
}
