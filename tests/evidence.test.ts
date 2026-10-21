import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { cashToTxn } from '../src/core/answers';
import { matchReceipt, receiptToLines, receiptToRow } from '../src/core/evidence';
import type { ReceiptRecord } from '../src/core/evidence';
import { checkLedgerFile, uploadEvidence, uploadLedger } from '../src/core/ledgerio';
import { adoptUploadStamps, formatStamp, stampUploads } from '../src/core/sync';
import { emptyOverlay } from '../src/core/types';
import type { Txn } from '../src/core/types';
import sample from '../src/data/seed/ledger.sample.json';

const ledger = sample as unknown as { accounts: any[]; txns: Txn[] };
const t = (id: string, date: string, cents: number, merchant: string, extra: Partial<Txn> = {}): Txn => ({ id, accountId: 'a', date, description: merchant.toUpperCase(), merchant, cents, kind: 'spend', source: 's', ...extra });

test('sample ledger passes the structural check; broken ones are named', () => {
  assert.equal(checkLedgerFile(ledger).problems.length, 0);
  const dup = { accounts: ledger.accounts, txns: [ledger.txns[0], ledger.txns[0]] };
  assert.match(checkLedgerFile(dup).problems.join(), /duplicate transaction/);
  assert.match(checkLedgerFile({ accounts: [], txns: [t('x', '2026-01-01', -5, 'A')] }).problems.join(), /unknown account/);
  assert.match(checkLedgerFile({ accounts: ledger.accounts, txns: [{ ...ledger.txns[0], cents: 1.5 }] }).problems.join(), /non-integer/);
  assert.equal(checkLedgerFile('nope').ledger, null);
});

test('receipt matching is confident only for exactly one charge', () => {
  const txns = [t('1', '2026-07-01', -4200, 'Kroger'), t('2', '2026-07-02', -4200, 'Target'), t('3', '2026-07-20', -4200, 'Kroger')];
  const r: ReceiptRecord = { merchant: 'KROGER #512', date: '2026-07-01', totalCents: 4200, lines: [] };
  assert.equal(matchReceipt(r, txns).txnId, '1');                                   // same store, near date: the later Kroger is out of range
  assert.equal(matchReceipt({ ...r, merchant: 'Corner Shop' }, txns).txnId, null);     // amount matches but not the store
  assert.equal(matchReceipt({ ...r, merchant: 'Shop' }, [t('1', '2026-07-01', -4200, 'Kroger'), t('2', '2026-07-02', -4200, 'Target')]).candidates.length, 2);
  assert.equal(matchReceipt({ ...r, totalCents: undefined }, txns).txnId, null);
  // two identical purchases at one store, two days apart: the receipt goes to the charge on its own date; two on the same date stay ambiguous
  const twin = [t('a', '2026-07-01', -3000, 'Shell Oil'), t('b', '2026-07-03', -3000, 'Shell Oil')];
  const shell = { merchant: 'Shell Oil', totalCents: 3000, lines: [] };
  assert.equal(matchReceipt({ ...shell, date: '2026-07-03' }, twin).txnId, 'b');
  assert.equal(matchReceipt({ ...shell, date: '2026-07-01' }, twin).txnId, 'a');
  assert.equal(matchReceipt({ ...shell, date: '2026-07-02' }, twin).txnId, null);
  assert.equal(matchReceipt({ ...shell, date: '2026-07-01' }, [t('a', '2026-07-01', -3000, 'Shell Oil'), t('c', '2026-07-01', -3000, 'Shell Oil')]).txnId, null);
  assert.equal(matchReceipt({ orderRef: 'D01-1', lines: [] }, [t('9', '2026-07-01', -1, 'Amazon', { ref: 'D01-1' })]).txnId, '9');
});

test('receipt lines always add up to the charge, or are withheld', () => {
  const r: ReceiptRecord = { lines: [{ item: 'milk', cents: 450 }, { item: 'rice', cents: 1200 }], taxCents: 100, totalCents: 1750 };
  const lines = receiptToLines(r, 1900);
  assert.equal(lines.reduce((s, l) => s + l.cents, 0), 1900);
  assert.deepEqual(lines.map((l) => l.item), ['milk', 'rice', 'Sales tax', 'Other (not itemised)']);
  assert.deepEqual(receiptToLines(r, 1000), []);
});

test('receipt row keeps every field, and raw extraction output', () => {
  const row = receiptToRow({ merchant: 'X', lines: [{ item: 'a', cents: 1, code: 'SKU1', qty: 2 }], cardLast4: '4444', storeRef: '#12', raw: { extra: 1 }, notes: 'faded' }, 'u/p.jpg', 'tx');
  assert.equal(row.card_last4, '4444'); assert.equal(row.store_ref, '#12'); assert.equal(row.txn_id, 'tx'); assert.deepEqual(row.raw, { extra: 1, notes: 'faded' });
});

// minimal stand-in for the Supabase client: records every call
function fakeDb(overlayBody: object | null = null) {
  const calls: { table: string; op: string; rows?: any; opts?: any }[] = []; const files: string[] = [];
  const chain = (table: string, op: string, rows?: any, opts?: any) => {
    calls.push({ table, op, rows, opts });
    const out: any = { error: null, data: null };
    out.select = () => ({ single: async () => ({ error: null, data: { id: `id-${calls.length}` } }) });
    return Object.assign(Promise.resolve(out), out);
  };
  const db: any = {
    from: (table: string) => ({
      upsert: (rows: any, opts: any) => chain(table, 'upsert', rows, opts),
      insert: (rows: any) => chain(table, 'insert', rows),
      select: () => { const one = { maybeSingle: async () => ({ error: null, data: overlayBody ? { body: overlayBody } : null }) }; return { ...one, eq: () => one }; },
    }),
    storage: { from: (bucket: string) => ({ upload: async (p: string) => { files.push(`${bucket}:${p}`); return { error: null }; } }) },
  };
  return { db, calls, files };
}

test('ledger upload: accounts first, statement rows only, chunked', async () => {
  const { db, calls } = fakeDb();
  const withManual = { accounts: ledger.accounts, txns: [...ledger.txns, { ...ledger.txns[0], id: 'cash:1', manual: true }] };
  const out = await uploadLedger(db, withManual, 100);
  assert.equal(calls[0].table, 'accounts');
  assert.equal(out.txns, ledger.txns.length);
  assert.ok(calls.filter((c) => c.table === 'txns').every((c) => c.rows.length <= 100));
  assert.ok(!calls.some((c) => c.rows?.some?.((r: any) => r.id === 'cash:1')));
});

test('evidence upload: files stored, raw lines kept, matched receipt patches the overlay without losing answers', async () => {
  const target = ledger.txns.find((x) => x.kind === 'spend')!;
  const { db, calls, files } = fakeDb({ patches: { other: { note: 'keep me' } }, answered: { q1: 'a' } });
  const receipt: ReceiptRecord = { merchant: target.merchant, date: target.date, totalCents: -target.cents, lines: [{ item: 'thing', cents: -target.cents }], sourceFile: 'Receipt/a.jpg', sha256: 'abc123def456aa', origin: 'offline_extract' };
  const res = await uploadEvidence(db, ledger, {
    statements: [{ id: 'S1', accountId: ledger.accounts[0].id, sourceFile: 'Statements/s1.pdf', sha256: '1111aaaabbbb', openingCents: 100, closingCents: 200, totals: { purchases: 5 } }],
    raw: [{ txnId: target.id, statementId: 'S1', row: { a: 1 } }, { txnId: 'not-in-ledger', row: {} }],
    receipts: [receipt, { merchant: 'Nowhere', date: '2000-01-01', totalCents: 1, lines: [], sourceFile: 'Receipt/b.jpg', sha256: 'zzz' }],
  }, { userId: 'u1', readFile: async () => ({ bytes: new Uint8Array([1]), contentType: 'application/pdf' }) });
  assert.deepEqual([res.statements, res.raw, res.receipts, res.files, res.linked], [1, 1, 2, 3, 1]);
  assert.equal(res.unlinked.length, 1);
  assert.ok(files.includes('statements:u1/1111aaaabbbb-s1.pdf'));
  const ov = calls.find((c) => c.table === 'overlays' && c.op === 'upsert')!.rows.body;
  assert.equal(ov.patches.other.note, 'keep me');
  assert.equal(ov.answered.q1, 'a');
  assert.ok(ov.patches[target.id].receiptId.startsWith('id-'));
  assert.equal(ov.patches[target.id].lines.reduce((s: number, l: any) => s + l.cents, 0), -target.cents);
});

test('manual entries record when they were entered, and are stamped only when a push succeeds', () => {
  const now = Date.parse('2026-10-17T12:47:00Z');
  const a = cashToTxn({ amount: 12.5, merchant: 'Corner Shop', category: 'groceries' }, '2026-10-17', now);
  assert.equal(a.createdAt, '2026-10-17T12:47:00.000Z');
  assert.equal(a.uploadedAt, undefined);
  const o = { ...emptyOverlay(), manual: [a] };
  const pushed = stampUploads(o, '2026-10-17T12:48:00.000Z');
  assert.equal(pushed.manual[0].uploadedAt, '2026-10-17T12:48:00.000Z');
  assert.equal(o.manual[0].uploadedAt, undefined, 'the original is untouched until the push succeeds');
  // an edit made while the push was in flight is kept; only the stamp is copied over
  const edited = { ...o, manual: [{ ...a, note: 'edited meanwhile' }] };
  const adopted = adoptUploadStamps(edited, pushed);
  assert.equal(adopted.manual[0].note, 'edited meanwhile');
  assert.equal(adopted.manual[0].uploadedAt, '2026-10-17T12:48:00.000Z');
  // already-stamped rows keep their first upload time
  assert.equal(stampUploads(pushed, '2030-01-01T00:00:00.000Z'), pushed);
});

test('time stamps are shown in the device time zone, readable', () => {
  const iso = new Date(2026, 9, 17, 8, 47).toISOString();   // built from local parts, so the test holds in any time zone
  assert.equal(formatStamp(iso), 'Oct 17, 2026, 8:47 AM');
  assert.equal(formatStamp(new Date(2026, 9, 17, 0, 5).toISOString()), 'Oct 17, 2026, 12:05 AM');
  assert.equal(formatStamp(new Date(2026, 9, 17, 13, 0).toISOString()), 'Oct 17, 2026, 1:00 PM');
  assert.equal(formatStamp(null), '');
});

test('your own receipts file, when present, reconciles and links to the ledger', { skip: !fs.existsSync(path.join(process.cwd(), 'seed/receipts.json')) || !fs.existsSync(path.join(process.cwd(), 'seed/ledger.json')) }, () => {
  const recs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'seed/receipts.json'), 'utf8')) as ReceiptRecord[];
  const led = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'seed/ledger.json'), 'utf8')) as { txns: Txn[] };
  for (const r of recs) {
    assert.ok(r.sourceFile, 'every receipt names its original file');
    const items = r.lines.reduce((s, l) => s + l.cents, 0);
    if (r.subtotalCents != null) assert.equal(items, r.subtotalCents, `${r.sourceFile}: items must sum to the printed subtotal`);
    const m = matchReceipt(r, led.txns);
    assert.ok(m.candidates.length <= 1, `${r.sourceFile}: ambiguous match ${m.candidates.join(', ')}`);
  }
});
