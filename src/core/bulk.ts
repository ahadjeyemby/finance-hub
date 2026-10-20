/**
 * Pure helpers for importing many files at once. No React, no network: the screen supplies the
 * workers, so all of this can be tested directly.
 */

/** Extensions the readers accept. Anything else in a chosen folder (.DS_Store, notes, zips) is skipped. */
export const READABLE = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];

export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();
export const isReadable = (name: string) => {
  const base = name.split('/').pop() ?? name;
  return !base.startsWith('.') && READABLE.includes(extOf(base));
};

/** "Aug-2" before "Aug-10", folders grouped: the order a person expects from a file manager. */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export interface FolderPick<F> { files: F[]; skipped: string[] }

/** Keep readable files, drop the rest (named, so the screen can say what was skipped), sort naturally. */
export function selectReadable<F extends { name: string }>(files: F[]): FolderPick<F> {
  const keep: F[] = []; const skipped: string[] = [];
  for (const f of files) { if (isReadable(f.name)) keep.push(f); else skipped.push(f.name); }
  keep.sort((a, b) => naturalCompare(a.name, b.name));
  return { files: keep, skipped };
}

/**
 * Split new files into ones to read and ones that repeat a file already queued or already stored.
 * `known` holds fingerprints of everything in the queue; it is updated so a second call sees this batch too.
 */
export function splitRepeats<F extends { sha256: string; name: string }>(files: F[], known: Set<string>): { fresh: F[]; repeats: { file: F; of: string }[] } {
  const firstName = new Map<string, string>();
  const fresh: F[] = []; const repeats: { file: F; of: string }[] = [];
  for (const f of files) {
    if (known.has(f.sha256)) repeats.push({ file: f, of: firstName.get(f.sha256) ?? 'a file already in this list' });
    else { known.add(f.sha256); firstName.set(f.sha256, f.name); fresh.push(f); }
  }
  return { fresh, repeats };
}

/** Run `worker` over `items` with at most `limit` in flight. `stop()` is checked before each start, so a cancel lets running jobs finish and starts no new ones. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, stop: () => boolean = () => false): Promise<number> {
  let next = 0; let started = 0;
  const lane = async () => {
    while (next < items.length && !stop()) {
      const item = items[next++]; started++;
      try { await worker(item); } catch { /* the worker reports its own failures; one bad file must not end the batch */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return started;
}

/** Errors worth one more try: rate limits, timeouts and dropped connections. A bad file or a rejected answer is not. */
export const isTransient = (message: string) => /\b(429|502|503|504)\b|rate.?limit|timed? ?out|timeout|network|fetch failed|temporar|overloaded|try again/i.test(message);

export async function withRetry<T>(fn: () => Promise<T>, tries = 3, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!isTransient((e as Error).message ?? '') || i === tries - 1) throw e;
      await wait(1500 * 2 ** i);
    }
  }
  throw last;
}

/** 'redact' = a statement scanned for sensitive details, waiting for the person to check what will be blacked out */
export type BulkStatus = 'queued' | 'reading' | 'redact' | 'review' | 'saving' | 'saved' | 'failed' | 'duplicate';
export interface Tally { total: number; waiting: number; reading: number; ready: number; attention: number; saving: number; saved: number; failed: number; duplicate: number; done: number }

/** Counts for the progress line. `ready` is only meaningful for items in review. */
export function tally(items: { status: BulkStatus; ready: boolean }[]): Tally {
  const t: Tally = { total: items.length, waiting: 0, reading: 0, ready: 0, attention: 0, saving: 0, saved: 0, failed: 0, duplicate: 0, done: 0 };
  for (const i of items) {
    if (i.status === 'queued') t.waiting++;
    else if (i.status === 'reading') t.reading++;
    else if (i.status === 'review') { if (i.ready) t.ready++; else t.attention++; }
    else if (i.status === 'redact') t.attention++;
    else if (i.status === 'saving') t.saving++;
    else if (i.status === 'saved') t.saved++;
    else if (i.status === 'failed') t.failed++;
    else t.duplicate++;
  }
  t.done = t.total - t.waiting - t.reading;     // finished being read, whatever the outcome
  return t;
}

export type Filter = 'all' | 'attention' | 'ready' | 'saved' | 'problems';

/** Which list a row belongs in. "problems" = failed reads and repeats, the rows that need a decision but not answers. */
export function matchesFilter(f: Filter, s: BulkStatus, ready: boolean): boolean {
  switch (f) {
    case 'all': return true;
    case 'attention': return (s === 'review' && !ready) || s === 'redact';
    case 'ready': return s === 'review' && ready;
    case 'saved': return s === 'saved';
    case 'problems': return s === 'failed' || s === 'duplicate';
  }
}

/** Plain-words progress for the header of the queue. */
export function progressLine(t: Tally): string {
  if (!t.total) return '';
  const parts: string[] = [];
  if (t.waiting + t.reading) parts.push(`${t.done} of ${t.total} read`);
  else parts.push(`All ${t.total} read`);
  if (t.ready) parts.push(`${t.ready} ready to save`);
  if (t.attention) parts.push(`${t.attention} ${t.attention === 1 ? 'needs' : 'need'} answers`);
  if (t.saved) parts.push(`${t.saved} saved`);
  if (t.failed) parts.push(`${t.failed} could not be read`);
  if (t.duplicate) parts.push(`${t.duplicate} already stored`);
  return parts.join(', ');
}

/**
 * Which kind of document a path looks like, judged from folder and file names only. Returns null when the path says
 * nothing or says both. Used to keep statements out of a receipts batch (and the reverse): every wrongly sent file is a paid model call.
 */
export function guessKind(path: string): 'statement' | 'receipt' | null {
  const p = path.toLowerCase();
  const stmt = /statements?\b|e?stmt/.test(p);
  const rcpt = /receipts?\b|(^|[\/_ -])order\b|(^|\/)amz-/.test(p);
  if (stmt === rcpt) return null;
  return stmt ? 'statement' : 'receipt';
}

/** Split a batch into files that fit what the person said they are adding and files that look like the other kind. */
export function separateByKind<F extends { name: string }>(files: F[], kind: 'statement' | 'receipt'): { fit: F[]; other: F[] } {
  const fit: F[] = []; const other: F[] = [];
  for (const f of files) { const g = guessKind(f.name); if (g && g !== kind) other.push(f); else fit.push(f); }
  return { fit, other };
}
