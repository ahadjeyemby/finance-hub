// Scanning a photo of a receipt like a document scanner: find the paper, cut it out flat, and clean up the light. This file holds the shared
// types and the stand-in for a platform with no scanner. The real code is scan.web.ts (the browser) and scan.native.ts (iPhone, iPad and
// Android); Metro picks the one that fits. Nothing here or there calls a model or any outside service: the picture is processed on the device.
import type { Quad, ScanMode, Suggestion } from '@/core/scan';

/** True where scanning can run: the web version and the phone and tablet builds. */
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

const unsupported = () => new Error('Scanning is not available here. The photo is used as taken.');

/** Decode a photo and look for the paper in it. */
export async function loadShot(_bytes: Uint8Array, _type: string): Promise<Shot> { throw unsupported(); }

/** A small preview (a data URL) of the scan for these corners, mode and turn. */
export function previewScan(_shot: Shot, _quad: Quad, _mode: ScanMode, _turns: number): string { throw unsupported(); }

/** The finished scan as a JPEG. */
export async function finishScan(_shot: Shot, _quad: Quad, _mode: ScanMode, _turns: number): Promise<{ bytes: Uint8Array; type: string }> { throw unsupported(); }

/** Forget the decoded photo. */
export function discardShot(_shot: Shot): void { /* nothing is held here */ }
