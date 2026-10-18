// Turns extracted statements into a normalised ledger file. Upload it to your database with `bun run ledger:upload`.
//
//   bun run ledger            your data:   seed/accounts.json + seed/raw/*.json  ->  seed/ledger.json   (git-ignored)
//   bun run ledger:sample     fake data:   examples/accounts.json + examples/raw/*.json  ->  src/data/seed/ledger.sample.json   (committed)
//
// The formats of accounts.json and the raw files are documented in docs/DATA.md.
import fs from 'node:fs';
import path from 'node:path';
import { classifyRow, makeId, pairTransfers, toCents } from '../src/core/classify';
import { setLocalRules } from '../src/core/merchants';
import type { RawApple, RawBank, RawCard, RawChase } from '../src/core/classify';
import type { RawRecord } from '../src/core/evidence';
import type { Account, Txn } from '../src/core/types';

type Format = 'bank' | 'card' | 'card_orders' | 'apple';
interface AccountConfig extends Account { source?: { format: Format; file: string; label: string } }
interface Config { windowStart: string; accounts: AccountConfig[] }

const root = path.resolve(__dirname, '..');
const sample = process.argv.includes('--sample');
if (sample) setLocalRules([]);   // the public sample must not depend on anyone's private merchant rules
const dir = path.join(root, sample ? 'examples' : 'seed');
// Your ledger goes to seed/ledger.json (git-ignored, outside src/ so it can never be bundled into the app).
const outFile = sample ? path.join(root, 'src/data/seed/ledger.sample.json') : path.join(root, 'seed/ledger.json');

if (!fs.existsSync(path.join(dir, 'accounts.json'))) {
  console.error(`No ${path.relative(root, dir)}/accounts.json. Copy examples/accounts.json to seed/accounts.json and edit it (see docs/DATA.md), or run with --sample.`);
  process.exit(1);
}
const config: Config = JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8'));
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, 'raw', f), 'utf8'));
const WINDOW_START = config.windowStart;

const accounts: Account[] = config.accounts.map(({ source: _source, ...a }) => a);
const typeOf = (id: string) => accounts.find((a) => a.id === id)!.type;

const seen = new Map<string, number>();
const txns: Txn[] = [];
// the untouched source line behind each transaction, so nothing a statement said is lost
const raws: RawRecord[] = [];
const push = (accountId: string, date: string, description: string, cents: number, source: string, extra: { appleCategory?: string; ref?: string } | undefined, src: { file: string; index: number; row: unknown; statement?: string }) => {
  if (date < WINDOW_START) return;
  const row = classifyRow({ accountId, date, description, cents, source, ref: extra?.ref }, { appleCategory: extra?.appleCategory, type: typeOf(accountId) });
  const id = makeId(accountId, date, cents, description, seen);
  txns.push({ ...row, id });
  raws.push({ txnId: id, statementId: src.statement, lineNo: src.index + 1, sourceFile: src.file, row: src.row as Record<string, unknown> });
};

for (const a of config.accounts) {
  if (!a.source) continue;
  const { format, file, label } = a.source;
  const src = (r: unknown, i: number, statement?: string) => ({ file, index: i, row: r, statement });
  if (format === 'bank') read<RawBank[]>(file).forEach((r, i) => push(a.id, r.date, r.description, toCents(r.amount), `${label} ${r.statement}`, undefined, src(r, i, r.statement)));
  else if (format === 'card') read<RawCard[]>(file).forEach((r, i) => push(a.id, r.date, r.description, toCents(r.section === 'pur' ? -r.amount : r.amount), `${label} ${r.statement}`, undefined, src(r, i, r.statement)));
  else if (format === 'card_orders') read<RawChase[]>(file).forEach((r, i) => push(a.id, r.date, r.description, toCents(-r.amount), `${label} ${r.statement}`, { ref: r.order ?? undefined }, src(r, i, r.statement)));
  else if (format === 'apple') read<RawApple[]>(file).forEach((r, i) => push(a.id, r.date, r.merchant, toCents(-r.amount), label, { appleCategory: r.appleCategory }, src(r, i)));
  else throw new Error(`Unknown format "${format}" for account ${a.id}`);
}

txns.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const pairing = pairTransfers(txns);

const kinds: Record<string, number> = {};
for (const t of txns) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
const dollars = (c: number) => (c / 100).toFixed(2);
const spend = txns.filter((t) => ['spend', 'fee', 'refund'].includes(t.kind)).reduce((s, t) => s - t.cents, 0);
console.log(`rows ${txns.length}`, kinds);
console.log(`spend (net of refunds) $${dollars(spend)}`);
console.log(`card payments paired ${pairing.paired}; card side with no bank leg: ${pairing.unmatchedCardPayments.length} ($${dollars(pairing.unmatchedCardPayments.reduce((s, t) => s + t.cents, 0))}); bank side with no card leg: ${pairing.unmatchedBankOut.length}`);
fs.writeFileSync(outFile, JSON.stringify({ builtFrom: sample ? 'examples' : 'seed/raw', accounts, txns }, null, 1));
if (!sample) {
  const kept = new Set(txns.map((t) => t.id));
  fs.writeFileSync(path.join(root, 'seed/ledger.raw.json'), JSON.stringify(raws.filter((r) => kept.has(r.txnId)), null, 1));
}
fs.writeFileSync(path.join(dir, 'transfer-audit.json'), JSON.stringify({
  unmatchedCardPayments: pairing.unmatchedCardPayments.map((t) => ({ account: t.accountId, date: t.date, amount: t.cents / 100, description: t.description })),
  unmatchedBankOut: pairing.unmatchedBankOut.map((t) => ({ date: t.date, amount: t.cents / 100, description: t.description })),
}, null, 1));
