// Loads YOUR ledger into YOUR Supabase project, signed in as you (row level security applies, no service key needed).
//
//   bun run ledger:upload            upload seed/ledger.json
//   bun run ledger:upload --wipe     delete your existing accounts, transactions and statement records first (receipts and overlays are kept), then upload (use after rebuilding the ledger)
//   bun run ledger:upload --dry-run  check the file and the sign-in, send nothing
//   bun run ledger:upload --sample   upload the fictional sample ledger (demo only)
//   bun run ledger:upload --file <path>
//   bun run ledger:upload --files <dir>   folder holding the original PDFs and photos (default: the folder above this project)
//
// Optional evidence, uploaded after the ledger when present (private, git-ignored):
//   seed/statements.json   one record per statement: period, balances, printed totals, terms
//   seed/ledger.raw.json   the untouched source line behind each transaction
//   seed/receipts.json     receipts and order confirmations with every item
// The original files named in those records (sourceFile) are stored in private buckets next to the data.
//
// Run it with bun: bun loads .env for us (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY).
// Credentials: AUDIT_EMAIL / AUDIT_PASSWORD from the environment, otherwise asked for in the terminal (password hidden).
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { checkLedgerFile, statementTxns, uploadEvidence, uploadLedger, wipeLedger } from '../src/core/ledgerio';
import type { EvidenceBundle } from '../src/core/ledgerio';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

function fail(msg: string): never { console.error(`\n${msg}\n`); process.exit(1); }

function ask(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      const w = (rl as unknown as { _writeToOutput: (s: string) => void });
      w._writeToOutput = (s: string) => { if (s.includes(question)) process.stdout.write(question); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

const looksMissingTable = (e: { code?: string; message?: string }) => e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message ?? '');

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) fail('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set in .env (copy .env.example). Run this with bun, not node.');

  const sample = flag('--sample');
  const candidates = arg('--file') ? [path.resolve(arg('--file')!)] : sample ? [path.join(root, 'src/data/seed/ledger.sample.json')] : [path.join(root, 'seed/ledger.json'), path.join(root, 'src/data/seed/ledger.json')];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) fail(`No ledger file found. Looked for:\n  ${candidates.join('\n  ')}\nBuild it with: bun run ledger`);
  if (/\.sample\./.test(file) && !sample) fail(`${file} is the fictional sample. Pass --sample if you really want it in your database.`);

  const { ledger, problems } = checkLedgerFile(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!ledger) fail(`${file} is not a valid ledger:\n  - ${problems.join('\n  - ')}`);
  const rows = statementTxns(ledger.txns);
  const sumCents = rows.reduce((s, t) => s + t.cents, 0);
  console.log(`File: ${path.relative(root, file)}${sample ? '  (FICTIONAL SAMPLE DATA)' : ''}`);
  console.log(`  ${ledger.accounts.length} accounts, ${rows.length} transactions, ${rows[0] ? rows.map((t) => t.date).sort()[0] : '-'} to ${rows[0] ? rows.map((t) => t.date).sort().at(-1) : '-'}`);

  const email = process.env.AUDIT_EMAIL || (await ask('Supabase user email: '));
  const password = process.env.AUDIT_PASSWORD || (await ask('Password: ', true));
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.signInWithPassword({ email, password });
  if (authError || !auth.user) {
    fail(`Sign-in failed: ${authError?.message ?? 'no user'}\n` + (/invalid login/i.test(authError?.message ?? '') ? 'Create the user first: Supabase dashboard > Authentication > Users > Add user > Create new user, with "Auto Confirm User" ticked.' : /not confirmed/i.test(authError?.message ?? '') ? 'Confirm the user in Authentication > Users, or recreate it with "Auto Confirm User" ticked.' : ''));
  }
  console.log(`Signed in as ${auth.user.email}`);

  const probe = await db.from('accounts').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id);
  if (probe.error) {
    fail(looksMissingTable(probe.error)
      ? 'The database tables do not exist yet. Apply the migration first:\n  supabase link --project-ref <your-project-ref>\n  supabase db push\nor paste supabase/migrations/0001_init.sql into the dashboard SQL Editor and run it.'
      : `Could not read your accounts table: ${probe.error.message}`);
  }
  console.log(`Database currently holds ${probe.count ?? 0} accounts.`);

  if (flag('--dry-run')) { console.log('Dry run: nothing sent.'); return; }
  if (flag('--wipe')) { await wipeLedger(db, auth.user.id); console.log('Existing statement rows deleted.'); }

  const sent = await uploadLedger(db, ledger);
  console.log(`Uploaded ${sent.accounts} accounts and ${sent.txns} transactions.`);

  // Evidence: statements, source lines, receipts, original files.
  const optional = <T>(rel: string): T | undefined => { const f = path.join(root, rel); return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : undefined; };
  const bundle: EvidenceBundle = sample ? {} : { statements: optional('seed/statements.json'), raw: optional('seed/ledger.raw.json'), receipts: optional('seed/receipts.json') };
  if (bundle.statements || bundle.raw || bundle.receipts) {
    const docRoot = path.resolve(arg('--files') ?? path.join(root, '..'));
    const CT: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.numbers': 'application/octet-stream', '.json': 'application/json' };
    const sha = (rel: string) => { const f = path.join(docRoot, rel); return fs.existsSync(f) ? createHash('sha256').update(fs.readFileSync(f)).digest('hex') : undefined; };
    // fingerprint every original that is present, and refuse a file that changed since extraction
    for (const rec of [...(bundle.statements ?? []), ...(bundle.receipts ?? [])]) {
      if (!rec.sourceFile) continue;
      const h = sha(rec.sourceFile);
      if (h && rec.sha256 && rec.sha256 !== h) fail(`${rec.sourceFile} has changed since it was extracted (fingerprint differs). Re-extract it first.`);
      if (h) rec.sha256 = h;
    }
    const readFile = async (rel: string) => { const f = path.join(docRoot, rel); if (!fs.existsSync(f)) return null; return { bytes: new Uint8Array(fs.readFileSync(f)), contentType: CT[path.extname(f).toLowerCase()] ?? 'application/octet-stream' }; };
    console.log(`Evidence: ${bundle.statements?.length ?? 0} statements, ${bundle.raw?.length ?? 0} source lines, ${bundle.receipts?.length ?? 0} receipts. Original files from ${docRoot}`);
    const ev = await uploadEvidence(db, ledger, bundle, { userId: auth.user.id, readFile, log: (l) => console.log(l) });
    console.log(`  stored ${ev.statements} statements, ${ev.raw} source lines, ${ev.receipts} receipts, ${ev.files} original files; ${ev.linked} receipts linked to a transaction.`);
    for (const x of ev.extraDocuments) console.log(`  EXTRA document: ${x.source} is another copy of ${x.of} (${x.why}); kept as evidence, no second purchase.`);
    for (const u of ev.unlinked) console.log(`  NOT linked: ${u.source} (${u.reason})${u.candidates.length ? `, candidates: ${u.candidates.join(', ')}` : ''}`);
  }

  // Read it back and compare, so "done" means the numbers match.
  let count = 0; let sum = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('txns').select('cents').eq('user_id', auth.user.id).order('id').range(from, from + 999);
    if (error) throw error;
    count += data.length; sum += data.reduce((s, r) => s + (r.cents as number), 0);
    if (data.length < 1000) break;
  }
  const ok = count === rows.length && sum === sumCents;
  console.log(`Check: database has ${count} transactions, net ${(sum / 100).toFixed(2)}; file has ${rows.length}, net ${(sumCents / 100).toFixed(2)}.`);
  if (!ok) fail('Counts or totals differ. Rows from an earlier upload may still be there. Run again with --wipe.');
  console.log('Match. Open the app, sign in, and it will load this data.');
  await db.auth.signOut();
}

main().catch((e) => fail(`Failed: ${e?.message ?? e}`));
