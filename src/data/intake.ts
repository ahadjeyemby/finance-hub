import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { ReceiptKey } from '@/core/dedupe';
import type { ReceiptRecord } from '@/core/evidence';
import { receiptToRow } from '@/core/evidence';
import { MAX_HINT, readingAsText, receiptAsText, receiptFromRead, receiptMisfits, settleReads, settleReceiptReads, statementFromRead, statementGap } from '@/core/intake';
import type { ReadReceipt, ReadStatement, StatementDraft, StatementPlan } from '@/core/intake';
import { uploadEvidence, uploadLedger } from '@/core/ledgerio';
import { selectReadable, withRetry } from '@/core/bulk';
import { digestHex, sniffMime, toBase64 } from '@/core/sha256';
import { callFunction, supabase } from './supabase';

export interface PickedFile { name: string; type: string; bytes: Uint8Array; sha256: string }

const MAX_BYTES = 10 * 1024 * 1024;
const NAME_TYPE: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

async function toPicked(name: string, bytes: Uint8Array, declared?: string | null): Promise<PickedFile> {
  // trust the bytes first: pickers sometimes report the wrong type
  const type = sniffMime(bytes) ?? declared ?? NAME_TYPE[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
  return { name, type, bytes, sha256: await digestHex(bytes) };
}

/** Browsers can hand over a whole folder. Phones cannot: there the person selects many files or photos instead. */
export const canPickFolder = Platform.OS === 'web';

export interface Picked { files: PickedFile[]; skipped: string[] }

/** Web only. Opens the browser's folder chooser and reads every PDF and image inside, subfolders included. */
export function pickFolder(): Promise<Picked> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('Choosing a folder works in the web version. On a phone, choose several files or photos.'));
    const el = document.createElement('input');
    el.type = 'file'; el.multiple = true; el.setAttribute('webkitdirectory', ''); el.style.display = 'none';
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; el.remove(); fn(); } };
    el.addEventListener('cancel', () => done(() => resolve({ files: [], skipped: [] })));
    el.addEventListener('change', async () => {
      try {
        const all = Array.from(el.files ?? []).map((f) => ({ name: f.webkitRelativePath || f.name, file: f }));
        const pick = selectReadable(all);
        const files: PickedFile[] = [];
        for (const { name, file } of pick.files) files.push(await toPicked(name, new Uint8Array(await file.arrayBuffer()), file.type));
        done(() => resolve({ files, skipped: pick.skipped }));
      } catch (e) { done(() => reject(e)); }
    });
    document.body.appendChild(el);
    el.click();
  });
}

/** Pick one or many receipts or statements. Returns [] when the person cancels. */
export async function pickFiles(source: 'files' | 'photos' | 'camera'): Promise<PickedFile[]> {
  if (source === 'files') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return [];
    const out: PickedFile[] = [];
    for (const a of r.assets) out.push(await toPicked(a.name, await assetBytes(a), a.mimeType));
    return selectReadable(out).files;
  }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off. Allow it in Settings, or choose a photo instead.');
  }
  const opts = { quality: 0.85, mediaTypes: ['images'] as ImagePicker.MediaType[] };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 0, orderedSelection: true });
  if (r.canceled) return [];
  const out: PickedFile[] = [];
  for (let i = 0; i < r.assets.length; i++) { const a = r.assets[i]; out.push(await toPicked(a.fileName ?? `photo-${Date.now()}-${i + 1}.jpg`, await assetBytes(a), a.mimeType)); }
  return out;
}

/** Read a picked asset from disk (or the browser's File) without going through base64, which would hold every photo in memory twice. */
async function assetBytes(a: { uri: string; file?: Blob }): Promise<Uint8Array> {
  if (Platform.OS === 'web' && a.file) return new Uint8Array(await a.file.arrayBuffer());
  return new Uint8Array(await new File(a.uri).arrayBuffer());
}

export type Found = { duplicateOf: string | null };

/** Has this exact file been stored before? Same bytes = same fingerprint, whatever the file is called. */
export async function findDuplicate(kind: 'receipt' | 'statement', sha256: string): Promise<Found> {
  if (!supabase) return { duplicateOf: null };
  const q = kind === 'receipt'
    ? await supabase.from('receipts').select('id, merchant, date').eq('sha256', sha256).limit(1)
    : await supabase.from('statements').select('id, label').eq('sha256', sha256).limit(1);
  if (q.error || !q.data?.length) return { duplicateOf: null };
  const row = q.data[0] as Record<string, string | null>;
  return { duplicateOf: kind === 'receipt' ? [row.merchant, row.date].filter(Boolean).join(' on ') || 'a stored receipt' : row.label ?? row.id };
}

export async function readReceiptFile(f: PickedFile): Promise<ReceiptRecord> {
  if (f.bytes.length > MAX_BYTES) throw new Error('This file is over 10 MB. Use a smaller photo or PDF.');
  const body = { file_base64: toBase64(f.bytes), media_type: f.type, filename: f.name };
  const read = async (second = false) => receiptFromRead(await withRetry(() => callFunction<ReadReceipt>('ingest-receipt', second ? { ...body, second_opinion: true } : body)), { fileName: f.name, sha256: f.sha256 });
  const first = await read();
  // a price shifted against its item is the usual reason a receipt does not add up, and it rarely repeats: read again and let the printed subtotal, total and item count choose
  if (receiptMisfits(first) === 0) return first;
  try { return settleReceiptReads(first, await read(true)); } catch { return first; }
}

export async function readStatementFile(f: PickedFile): Promise<StatementDraft> {
  if (f.bytes.length > MAX_BYTES) throw new Error('This file is over 10 MB. Split it by month.');
  const body = { file_base64: toBase64(f.bytes), media_type: f.type, filename: f.name };
  const read = async (second = false) => statementFromRead(await withRetry(() => callFunction<ReadStatement>('ingest-statement', second ? { ...body, second_opinion: true } : body)));
  const first = await read();
  // a misread digit is the usual reason a statement does not add up, and it rarely repeats: on a failed balance check read the file once more and let the printed balance choose
  const gap = statementGap(first);
  if (gap == null || gap === 0 || first.truncated) return first;
  try { return settleReads(first, await read(true)); } catch { return first; }
}

/** The readers the backend allows, for the picker on a card. Empty when the backend cannot say (offline, or functions not yet redeployed). */
export async function listReaders(): Promise<string[]> {
  try { return (await callFunction<{ models: string[] }>('ingest-receipt', { action: 'models' })).models ?? []; } catch { return []; }
}

/** One more reading of a receipt, on request. A chosen reader reads in plain JSON, the mode measured for every reader offered. Odd attempts use the plain-JSON request and even ones the tool-call request, because the two fail on different receipts. Never replaces anything by itself. */
export async function rereadReceiptFile(f: PickedFile, attempt: number, model?: string, hint?: string, current?: ReceiptRecord): Promise<ReceiptRecord> {
  if (f.bytes.length > MAX_BYTES) throw new Error('This file is over 10 MB. Use a smaller photo or PDF.');
  const body = { file_base64: toBase64(f.bytes), media_type: f.type, filename: f.name, ...(model ? { model } : hint?.trim() || attempt % 2 === 0 ? {} : { second_opinion: true }),
    // with a note, the reader is also given the note and the reading on screen (it reads in plain JSON, like every chosen or second reading)
    ...(hint?.trim() && current ? { hint: hint.trim().slice(0, MAX_HINT), previous: receiptAsText(current) } : {}) };
  return receiptFromRead(await withRetry(() => callFunction<ReadReceipt>('ingest-receipt', body)), { fileName: f.name, sha256: f.sha256 });
}

/** One more reading of a statement the person has looked at, with their note about what is wrong. Never replaces anything by itself: the caller shows it next to the current reading. */
export async function rereadStatementWithHint(f: PickedFile, current: StatementDraft, hint: string, model?: string): Promise<StatementDraft> {
  if (f.bytes.length > MAX_BYTES) throw new Error('This file is over 10 MB. Split it by month.');
  // without a note it is a plain second reading by the second-opinion model; with one, the reader is also told the note and the earlier reading
  const body = { file_base64: toBase64(f.bytes), media_type: f.type, filename: f.name, ...(hint.trim() ? { hint: hint.slice(0, MAX_HINT), previous: readingAsText(current) } : model ? {} : { second_opinion: true }), ...(model ? { model } : {}) };
  return statementFromRead(await withRetry(() => callFunction<ReadStatement>('ingest-statement', body)));
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
const userId = async () => { const { data } = await supabase!.auth.getSession(); const id = data.session?.user.id; if (!id) throw new Error('Signed out. Sign in again, then save.'); return id; };

/** Store the original file and every field of the receipt. Returns the receipt id. Throws with a readable message on failure. */
export async function saveReceiptRecord(rec: ReceiptRecord, file: PickedFile | null, txnId: string | null): Promise<string> {
  if (!supabase) throw new Error('No database is connected, so nothing can be saved.');
  const uid = await userId();
  let path: string | null = null;
  if (file) {
    path = `${uid}/${file.sha256.slice(0, 12)}-${safe(file.name)}`;
    const up = await supabase.storage.from('receipts').upload(path, file.bytes, { contentType: file.type, upsert: true });
    if (up.error) throw new Error(`Could not store the original file: ${up.error.message}`);
  }
  const row = receiptToRow({ ...rec, sha256: file?.sha256 ?? rec.sha256, sourceFile: file?.name ?? rec.sourceFile, origin: file ? 'app_upload' : 'typed' }, path, txnId);
  const q = file
    ? await supabase.from('receipts').upsert(row, { onConflict: 'user_id,sha256' }).select('id').single()
    : await supabase.from('receipts').insert(row).select('id').single();
  if (q.error) throw new Error(`Could not save the receipt: ${q.error.message}`);
  return q.data.id as string;
}

/** Save an approved statement: account, rows, the statement record, each source line and the original PDF. */
export async function saveStatementPlan(plan: StatementPlan, file: PickedFile | null): Promise<void> {
  if (!supabase) throw new Error('No database is connected, so nothing can be saved.');
  const uid = await userId();
  const ledger = { accounts: [plan.account], txns: plan.txns };
  await uploadLedger(supabase, ledger);
  await uploadEvidence(supabase, ledger, { statements: [{ ...plan.statement, sha256: file?.sha256 ?? plan.statement.sha256 }], raw: plan.raw }, {
    userId: uid,
    readFile: async () => (file ? { bytes: file.bytes, contentType: file.type } : null),
  });
  for (const u of plan.pairUpdates) {
    const r = await supabase.from('txns').update({ pair_id: u.pairId }).eq('id', u.id);
    if (r.error) throw new Error(`Saved, but could not link a card payment: ${r.error.message}`);
  }
}

/** What is already stored, in the small form the duplicate check needs. Empty when offline or on error: the check then only sees the current batch. */
export async function loadStoredReceipts(): Promise<ReceiptKey[]> {
  if (!supabase) return [];
  const q = await supabase.from('receipts').select('id, merchant, date, time, total_cents, order_ref, card_last4, store_ref, source_file, txn_id, payment_method').limit(5000);
  if (q.error) return [];
  return (q.data ?? []).map((r) => ({
    id: r.id as string, label: (r.source_file as string | null) ?? 'a stored receipt', merchant: r.merchant as string | null, date: r.date as string | null, time: r.time as string | null,
    totalCents: r.total_cents as number | null, orderRef: r.order_ref as string | null, cardLast4: r.card_last4 as string | null, storeRef: r.store_ref as string | null, txnId: r.txn_id as string | null, paymentMethod: r.payment_method as string | null,
  }));
}
