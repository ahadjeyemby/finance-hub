// Redacting a statement on the device before it is read or stored. This file is what the phone builds get: redaction is web only for now, and the
// real engine is redact.web.ts (Metro picks it on the web). Nothing here or there calls a model or any outside service: page rendering and text
// recognition run in the browser from files this app serves itself (public/redact/, copied by scripts/copy-redaction-assets.js).
import type { PageWords, RedactBox } from '@/core/redact';

/** True where redaction can run: in the web version. */
export const redactionSupported = false;

export interface ScanPage { width: number; height: number; /** a small picture of the page for the review screen (a data URL) */ preview: string }
export interface Scan {
  pages: ScanPage[];
  /** what looked sensitive, all switched on; the review screen changes this list */
  boxes: RedactBox[];
  /** what text recognition found on each page, so a new search (another word to hide) needs no new reading. In memory only. */
  words: PageWords[];
  /** the unredacted page images, kept only in memory until the redaction is burned in or abandoned */
  pageImages?: unknown[];
}

const unsupported = () => new Error('Redaction works in the web version of the app. Open this page in a browser to redact a statement.');

/** Render the pages and look for sensitive text. `hide` are words to always hide. Reports progress as it goes. */
export async function scanForRedaction(_bytes: Uint8Array, _type: string, _hide: string[], _onProgress?: (message: string) => void): Promise<Scan> { throw unsupported(); }

/** Burn the switched-on boxes into the page images and return the redacted file (a PDF for a PDF, a JPEG for a photo). The original is not kept. */
export async function burnRedactions(_scan: Scan, _boxes: RedactBox[], _wasPdf: boolean): Promise<{ bytes: Uint8Array; type: string }> { throw unsupported(); }

/** Forget the unredacted page images. */
export function discardScan(_scan: Scan): void { /* nothing is held on a phone */ }
