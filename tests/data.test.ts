import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv/dist/2020';

import sample from '../src/data/seed/ledger.sample.json';
import schema from '../docs/schema/ledger.schema.json';

const root = path.resolve(__dirname, '..');
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

test('the committed sample ledger matches the published JSON Schema', () => {
  assert.ok(validate(sample), JSON.stringify(validate.errors?.slice(0, 3)));
});

test('your own ledger, when present, matches the schema', { skip: !ownLedger() }, () => {
  const file = ownLedger()!;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(validate(data), JSON.stringify(validate.errors?.slice(0, 3)));
});

test('sample data is fictional: only reserved example account numbers, no real-looking identifiers', () => {
  const lasts = new Set((sample as any).accounts.map((a: any) => a.last4).filter(Boolean));
  assert.deepEqual([...lasts].sort(), ['1111', '2222', '3333', '4444']);
});

test('personal data paths are git-ignored, sample paths are not', { skip: !hasGit() }, () => {
  const ignored = (p: string) => { try { execFileSync('git', ['check-ignore', '-q', p], { cwd: root }); return true; } catch { return false; } };
  for (const p of ['seed/raw/x.json', 'seed/accounts.json', 'seed/ledger.json', 'src/data/seed/ledger.json', 'src/data/seed/merchant-rules.json', 'scripts/extract/statements.py', 'receipts/a.jpg', '.env', '.env.local'])
    assert.ok(ignored(p), `${p} must be ignored`);
  for (const p of ['src/data/seed/ledger.sample.json', 'src/data/seed/merchant-rules.sample.json', 'examples/accounts.json', 'examples/raw/bank1111.json', '.env.example'])
    assert.ok(!ignored(p), `${p} must be committed`);
});

function ownLedger() { return ['seed/ledger.json', 'src/data/seed/ledger.json'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f)); }
function hasGit() { try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } }
