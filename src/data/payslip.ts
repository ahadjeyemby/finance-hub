import { withRetry } from '@/core/bulk';
import type { ReadPayslip } from '@/core/payslip';
import { toBase64 } from '@/core/sha256';
import type { PickedFile } from './intake';
import { callFunction } from './supabase';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Read a pay slip with the backend's pay slip reader (the ingest-payslip function). The reading is only a starting point: the caller puts it in the
 * pay record form, where the person checks it against the slip and the app checks that it adds up. Nothing is saved here.
 */
export async function readPayslipFile(f: PickedFile, secondOpinion = false): Promise<ReadPayslip> {
  if (f.bytes.length > MAX_BYTES) throw new Error('This file is over 10 MB. Use a smaller photo or PDF.');
  const body = { file_base64: toBase64(f.bytes), media_type: f.type, filename: f.name, ...(secondOpinion ? { second_opinion: true } : {}) };
  return withRetry(() => callFunction<ReadPayslip>('ingest-payslip', body));
}
