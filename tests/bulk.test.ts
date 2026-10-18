import assert from 'node:assert/strict';
import { test } from 'node:test';

import { digestHex, sha256Hex } from '../src/core/sha256';
import { guessKind, isReadable, separateByKind, isTransient, matchesFilter, naturalCompare, progressLine, runPool, selectReadable, splitRepeats, tally, withRetry } from '../src/core/bulk';
import type { BulkStatus } from '../src/core/bulk';

test('folder contents: only readable files, junk named, natural order', () => {
  const pick = selectReadable([
    { name: 'Receipt/Aug/Aug-10.jpg' }, { name: 'Receipt/Aug/Aug-2.jpg' }, { name: 'Receipt/.DS_Store' }, { name: 'notes.txt' },
    { name: 'Receipt/Aug/Aug-1.JPG' }, { name: 'E-Receipt/AMZ-001.pdf' }, { name: 'Receipt/._Aug-3.jpg' },
  ]);
  assert.deepEqual(pick.files.map((f) => f.name), ['E-Receipt/AMZ-001.pdf', 'Receipt/Aug/Aug-1.JPG', 'Receipt/Aug/Aug-2.jpg', 'Receipt/Aug/Aug-10.jpg']);
  assert.deepEqual(pick.skipped, ['Receipt/.DS_Store', 'notes.txt', 'Receipt/._Aug-3.jpg']);
  assert.ok(isReadable('a.webp') && !isReadable('a.heic') && !isReadable('.hidden.pdf'));
  assert.ok(naturalCompare('Aug-2', 'Aug-10') < 0);
});

test('repeats inside one batch and against the queue are caught before any model call', () => {
  const known = new Set<string>(['already-queued']);
  const a = splitRepeats([{ name: 'a.jpg', sha256: 'x' }, { name: 'copy of a.jpg', sha256: 'x' }, { name: 'b.jpg', sha256: 'already-queued' }, { name: 'c.jpg', sha256: 'y' }], known);
  assert.deepEqual(a.fresh.map((f) => f.name), ['a.jpg', 'c.jpg']);
  assert.deepEqual(a.repeats.map((r) => [r.file.name, r.of]), [['copy of a.jpg', 'a.jpg'], ['b.jpg', 'a file already in this list']]);
  const b = splitRepeats([{ name: 'again.jpg', sha256: 'y' }], known);     // a later pick sees the first batch
  assert.equal(b.fresh.length, 0);
});

test('pool never exceeds its limit, finishes everything, and survives a failing job', async () => {
  let live = 0; let peak = 0; const done: number[] = [];
  const started = await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    if (n === 4) throw new Error('boom');
    done.push(n);
  });
  assert.equal(started, 8);
  assert.equal(peak, 3);
  assert.deepEqual([...done].sort((a, b) => a - b), [1, 2, 3, 5, 6, 7, 8]);
});

test('cancel lets running jobs finish and starts no new ones', async () => {
  let stopped = false; const ran: number[] = [];
  const started = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => { ran.push(n); if (n === 2) stopped = true; await new Promise((r) => setTimeout(r, 5)); }, () => stopped);
  assert.ok(started < 6);
  assert.equal(started, ran.length);
});

test('pool with no items or a zero limit does not hang', async () => {
  assert.equal(await runPool([], 3, async () => {}), 0);
  assert.equal(await runPool([1, 2], 0, async () => {}), 2);
});

test('retry: transient errors retry with backoff, real errors do not', async () => {
  const waits: number[] = []; const wait = async (ms: number) => { waits.push(ms); };
  let n = 0;
  const v = await withRetry(async () => { if (++n < 3) throw new Error('HTTP 429 rate limit'); return 'ok'; }, 3, wait);
  assert.equal(v, 'ok'); assert.deepEqual(waits, [1500, 3000]);

  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw new Error('The statement has no readable text'); }, 3, wait), /no readable text/);
  assert.equal(m, 1);

  let k = 0;
  await assert.rejects(withRetry(async () => { k++; throw new Error('request timed out'); }, 2, wait), /timed out/);
  assert.equal(k, 2);
  assert.ok(isTransient('Function returned 503') && !isTransient('Total does not match'));
});

const row = (status: BulkStatus, ready = false) => ({ status, ready });

test('tally and progress line, mid-run and finished', () => {
  const mid = tally([row('queued'), row('queued'), row('reading'), row('review', true), row('review', false), row('saved'), row('failed'), row('duplicate')]);
  assert.deepEqual({ ...mid }, { total: 8, waiting: 2, reading: 1, ready: 1, attention: 1, saving: 0, saved: 1, failed: 1, duplicate: 1, done: 5 });
  assert.equal(progressLine(mid), '5 of 8 read, 1 ready to save, 1 needs answers, 1 saved, 1 could not be read, 1 already stored');
  const end = tally([row('review', true), row('review', true), row('review', false), row('review', false)]);
  assert.equal(progressLine(end), 'All 4 read, 2 ready to save, 2 need answers');
  assert.equal(progressLine(tally([])), '');
});

test('filters put each row in exactly the list the label says', () => {
  assert.ok(matchesFilter('attention', 'review', false) && !matchesFilter('attention', 'review', true));
  assert.ok(matchesFilter('ready', 'review', true) && !matchesFilter('ready', 'saved', true));
  assert.ok(matchesFilter('problems', 'failed', false) && matchesFilter('problems', 'duplicate', false) && !matchesFilter('problems', 'review', false));
  assert.ok(matchesFilter('all', 'reading', false) && matchesFilter('saved', 'saved', false));
});

test('platform digest matches the plain-TypeScript one', async () => {
  const data = new Uint8Array(5000).map((_, i) => (i * 31) % 251);
  assert.equal(await digestHex(data), sha256Hex(data));
  assert.equal(await digestHex(new Uint8Array(0)), sha256Hex(new Uint8Array(0)));
});

test('a mixed parent folder is sorted by what the paths say, and unclear paths are kept', () => {
  assert.equal(guessKind('Audit-2026/Statements/eStmt_2026-06-10.pdf'), 'statement');
  assert.equal(guessKind('Statements/1A9999D5-list.pdf'), 'statement');
  assert.equal(guessKind('Receipt/Aug/Aug-1.jpg'), 'receipt');
  assert.equal(guessKind('E-Receipt/AMZ-001.pdf'), 'receipt');
  assert.equal(guessKind('E-Receipt/Order Details.pdf'), 'receipt');
  assert.equal(guessKind('IMG_0042.jpg'), null);
  assert.equal(guessKind('Receipts for statements/x.pdf'), null);     // says both: do not guess
  const r = separateByKind([{ name: 'Receipt/a.jpg' }, { name: 'Statements/b.pdf' }, { name: 'scan.pdf' }], 'receipt');
  assert.deepEqual(r.fit.map((f) => f.name), ['Receipt/a.jpg', 'scan.pdf']);
  assert.deepEqual(r.other.map((f) => f.name), ['Statements/b.pdf']);
  assert.equal(separateByKind([{ name: 'Statements/b.pdf' }], 'statement').other.length, 0);
});
