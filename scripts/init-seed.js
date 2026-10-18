// Makes a fresh clone runnable. The app imports one git-ignored file that holds YOUR rules:
//   src/data/seed/merchant-rules.json  your own merchant rules
// When it is missing, copy the fictional sample next to it. An existing file is never touched.
// The app does NOT bundle a ledger: transactions are loaded from your Supabase database (see docs/DATA.md).
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(__dirname, '../src/data/seed');
fs.mkdirSync(dir, { recursive: true });
for (const name of ['merchant-rules']) {
  const target = path.join(dir, `${name}.json`);
  const sample = path.join(dir, `${name}.sample.json`);
  if (!fs.existsSync(target) && fs.existsSync(sample)) {
    fs.copyFileSync(sample, target);
    console.log(`init-seed: ${name}.json not found, using the sample data`);
  }
}
