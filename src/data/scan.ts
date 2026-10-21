// Scanning a photo of a receipt like a document scanner: find the paper, cut it out flat, and clean up the light. This is the version phone
// builds get: it is web only for now, and the real code is scan.web.ts (Metro picks it on the web). On a phone the photo is used as taken.
// Nothing here or there calls a model or any outside service: the picture is decoded and processed on the device.
import type { Quad, ScanMode, Suggestion } from '@/core/scan';

/** True where scanning can run: in the web version. */
export const scanSupported = false;

export interface Shot {
  width: number; height: number;
  /** a small copy of the whole photo for the crop screen (a data URL) */
  preview: string;
  /** where the paper looks to be */
  suggestion: Suggestion;
  /** the decoded photo, kept in memory until the scan is finished or abandoned */
  held?: unknown;
}

const unsupported = () => new Error('Scanning works in the web version of the app. The photo is used as taken.');

/** Decode a photo and look for the paper in it. */
export async function loadShot(_bytes: Uint8Array, _type: string): Promise<Shot> { throw unsupported(); }

/** A small preview (a data URL) of the scan for these corners, mode and turn. */
export function previewScan(_shot: Shot, _quad: Quad, _mode: ScanMode, _turns: number): string { throw unsupported(); }

/** The finished scan as a JPEG. */
export async function finishScan(_shot: Shot, _quad: Quad, _mode: ScanMode, _turns: number): Promise<{ bytes: Uint8Array; type: string }> { throw unsupported(); }

/** Forget the decoded photo. */
export function discardShot(_shot: Shot): void { /* nothing is held on a phone */ }
