// Scanning a photo of a receipt, for the web version: the picture is decoded onto a canvas, core/scan.ts finds the paper, cuts it out flat and
// cleans up the light, and the result is written as a JPEG. Everything runs in the browser; the photo goes nowhere until the person uses the scan.
import { findDocument, scanImage } from '@/core/scan';
import type { Img, Quad, ScanMode } from '@/core/scan';
import type { Shot } from './scan';

export const scanSupported = true;

/** Photos from a phone are 12 megapixels or more; the work is done on a copy no larger than this on its longest side. */
const MAX_SIDE = 3000;
const PREVIEW_SIDE = 900;
const RESULT_PREVIEW_SIDE = 700;
const QUALITY = 0.9;

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const toDataUrl = (img: Img, quality = 0.8) => {
  const c = canvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c.toDataURL('image/jpeg', quality);
};

export async function loadShot(bytes: Uint8Array, type: string): Promise<Shot> {
  // the browser applies the photo's own rotation (EXIF) when it decodes it
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const img: Img = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
  const p = Math.min(1, PREVIEW_SIDE / Math.max(w, h));
  const pc = canvas(Math.round(w * p), Math.round(h * p));
  pc.getContext('2d')!.drawImage(c, 0, 0, pc.width, pc.height);
  return { width: w, height: h, preview: pc.toDataURL('image/jpeg', 0.8), suggestion: findDocument(img), held: img };
}

export function previewScan(shot: Shot, quad: Quad, mode: ScanMode, turns: number): string {
  return toDataUrl(scanImage(shot.held as Img, quad, mode, turns, RESULT_PREVIEW_SIDE));
}

export async function finishScan(shot: Shot, quad: Quad, mode: ScanMode, turns: number): Promise<{ bytes: Uint8Array; type: string }> {
  const img = scanImage(shot.held as Img, quad, mode, turns);
  const c = canvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const blob: Blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not write the scan.'))), 'image/jpeg', QUALITY));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg' };
}

export function discardShot(shot: Shot): void {
  shot.held = undefined;
}
