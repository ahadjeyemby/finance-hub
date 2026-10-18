// Generates FICTIONAL statements for the public sample ledger. No real person, account or transaction is used.
// Output is deterministic (fixed seed), so the committed files only change when this script changes.
//
//   bun run sample      writes examples/accounts.json + examples/raw/*.json and builds src/data/seed/ledger.sample.json
//
// The shapes written here are the same shapes scripts/extract produces from real statements (docs/DATA.md).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'examples');
fs.mkdirSync(path.join(out, 'raw'), { recursive: true });

// mulberry32: tiny seeded PRNG
let a = 0x2026_0601;
const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const int = (lo: number, hi: number) => Math.floor(lo + rnd() * (hi - lo + 1));
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const code = (n: number) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[int(0, 30)]).join('');

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09'];
const day = (month: string, d: number) => `${month}-${String(d).padStart(2, '0')}`;
const within = (date: string, from: string, to: string) => date >= from && date <= to;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);

const COVER = {
  chk: { from: '2026-06-01', to: '2026-09-15' },
  harbor: { from: '2026-06-01', to: '2026-09-10' },
  orchard: { from: '2026-06-01', to: '2026-09-09' },
  pebble: { from: '2026-06-01', to: '2026-09-26' },
};

// ---------- Northwind Bank checking (bank) ----------
interface Bank { statement: string; date: string; description: string; amount: number }
const chk: Bank[] = [];
const harborRows: { statement: string; section: 'pay' | 'pur'; date: string; description: string; amount: number }[] = [];
const orchardRows: { statement: string; date: string; description: string; amount: number; order: string | null }[] = [];
const pebbleRows: { date: string; description: string; merchant: string; appleCategory: string; type: string; amount: number }[] = [];

const addChk = (m: string, date: string, description: string, amount: number) => { if (within(date, COVER.chk.from, COVER.chk.to)) chk.push({ statement: `sample-${m}`, date, description, amount }); };
const addHarbor = (m: string, section: 'pay' | 'pur', date: string, description: string, amount: number) => { if (within(date, COVER.harbor.from, COVER.harbor.to)) harborRows.push({ statement: `sample-${m}`, section, date, description, amount }); };
const addOrchard = (m: string, date: string, description: string, amount: number, order: string | null = null) => { if (within(date, COVER.orchard.from, COVER.orchard.to)) orchardRows.push({ statement: `sample-${m}`, date, description, amount, order }); };
const addPebble = (date: string, merchant: string, appleCategory: string, amount: number, description = merchant, type = 'Purchase') => { if (within(date, COVER.pebble.from, COVER.pebble.to)) pebbleRows.push({ date, description, merchant, appleCategory, type, amount }); };

let orderNo = 1;
const order = () => `D01-${String(orderNo++).padStart(7, '0')}-${String(int(1000000, 9999999))}`;

for (const m of MONTHS) {
  // ----- checking: income, bills, card payments -----
  addChk(m, day(m, 1), 'ACME CORP PAYROLL DES:PAYROLL ID:000123', 2150);
  addChk(m, day(m, 15), 'ACME CORP PAYROLL DES:PAYROLL ID:000123', 2150);
  addChk(m, day(m, 2), `ZELLE PAYMENT TO JORDAN LEE CONF# ${code(9)}`, -1450);
  addChk(m, day(m, 8), 'T-MOBILE DES:WIRELESS', -between(84, 87));
  addChk(m, day(m, 12), 'STATE FARM MUTUAL AUTO INS', -between(90, 96));
  if (m !== '2026-09') addChk(m, day(m, 28), 'DEPOSIT (description redacted)', 640);   // sender hidden on the statement: the app asks
  if (m === '2026-07') addChk(m, day(m, 21), 'MOBILE DEPOSIT', 125);
  if (m === '2026-07') addChk(m, day(m, 18), 'Online Banking transfer to CHK 9999', -500);  // to an account we cannot see

  // card payments: one bank leg, one card leg a few days later
  for (const [d, last4, card] of [[10, '2222', 'harbor'], [25, '2222', 'harbor'], [14, '3333', 'orchard'], [22, '4444', 'pebble']] as const) {
    const amt = between(120, 520);
    const date = day(m, d);
    addChk(m, date, `Mobile Banking payment to CRD ${last4}`, -amt);
    const legDate = addDays(date, int(1, 3));
    if (card === 'harbor') addHarbor(m, 'pay', legDate, `PAYMENT FROM CHK 1111 CONF# ${code(9)}`, amt);
    if (card === 'orchard') addOrchard(m, legDate, 'Payment Thank You-Mobile', -amt);
    if (card === 'pebble') addPebble(legDate, 'Ach Deposit Internet Transfer From Account Ending In 1111', 'Payment', -amt, 'ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1111', 'Payment');
  }

  // ----- Harbor Card: everyday spending -----
  for (let i = 0; i < 3; i++) addHarbor(m, 'pur', day(m, int(1, 28)), `KROGER #${int(100, 999)} SPRINGFIELD IL`, between(48, 142));
  for (let i = 0; i < 2; i++) addHarbor(m, 'pur', day(m, int(1, 28)), `ALDI ${int(10000, 99999)} SPRINGFIELD IL`, between(35, 96));
  for (let i = 0; i < 2; i++) addHarbor(m, 'pur', day(m, int(1, 28)), `WAL-MART #${int(1000, 4999)} SPRINGFIELD IL`, between(22, 175));
  for (let i = 0; i < 2; i++) addHarbor(m, 'pur', day(m, int(1, 28)), `SHELL OIL ${int(10000000, 99999999)}QPS SPRINGFIELD IL`, between(31, 58));
  for (let i = 0; i < 3; i++) addHarbor(m, 'pur', day(m, int(1, 28)), pick([`STARBUCKS STORE ${int(10000, 99999)} SPRINGFIELD IL`, `CHIPOTLE ${int(1000, 4999)} SPRINGFIELD IL`, `MCDONALDS F${int(1000, 9999)} SPRINGFIELD IL`]), between(5, 26));
  addHarbor(m, 'pur', day(m, 5), 'NETFLIX.COM 866-579-7172 CA', 15.49);
  addHarbor(m, 'pur', day(m, 11), 'SPOTIFY USA 877-7781161 NY', 11.99);
  addHarbor(m, 'pur', day(m, 3), 'GITHUB, INC. SAN FRANCISCO CA', 4);
  addHarbor(m, 'pur', day(m, 6), `HEROKU* ${m.slice(5) === '06' ? 'JUN' : m.slice(5) === '07' ? 'JUL' : m.slice(5) === '08' ? 'AUG' : 'SEP'}-${int(100000000, 999999999)} WWW.HEROKU.CO CA`, 7);
  addHarbor(m, 'pur', day(m, int(9, 24)), `CVS/PHARMACY #${int(1000, 9999)} SPRINGFIELD IL`, between(8, 45));
  addHarbor(m, 'pur', day(m, int(2, 27)), 'BLUE HERON WELLNESS SPRINGFIELD IL', between(45, 90));       // unknown merchant: the app asks for a category
  addHarbor(m, 'pur', day(m, int(2, 27)), `PAYPAL *PIXELCRAFT ${int(1000000000, 9999999999)} CA`, between(6, 19)); // small unknown
  if (m === '2026-07') addHarbor(m, 'pur', day(m, 9), 'SPRINGFIELD MOTORS REPAIR IL', 1250);            // large one-off
  if (m === '2026-08') addHarbor(m, 'pur', day(m, 14), 'LINKEDIN PRE 8442403888 CA', 39.99);             // business or personal?
  if (m === '2026-07') addHarbor(m, 'pay', day(m, 19), 'WAL-MART #2417 STORE RETURN SPRINGFIELD IL', 24.99); // refund
  if (m === '2026-08') addHarbor(m, 'pay', day(m, 30), 'CASHREWARD STATEMENT CREDIT', between(9, 14));      // card rewards

  // ----- Orchard Visa: online and warehouse -----
  for (let i = 0; i < 4; i++) { const o = order(); addOrchard(m, day(m, int(1, 28)), `AMAZON MKTPL*${code(5).toUpperCase()} AMZN.COM/BILL WA`, between(11, 92), o); }
  addOrchard(m, day(m, int(1, 28)), 'AMAZON PRIME*' + code(6).toUpperCase() + ' AMZN.COM/BILL WA', 14.99);
  for (let i = 0; i < 2; i++) addOrchard(m, day(m, int(1, 28)), `COSTCO WHSE #${int(100, 1999)} SPRINGFIELD IL`, between(88, 264));
  addOrchard(m, day(m, int(1, 28)), `COSTCO GAS #${int(100, 1999)} SPRINGFIELD IL`, between(30, 52));
  addOrchard(m, day(m, int(1, 28)), `THE HOME DEPOT #${int(1000, 9999)} SPRINGFIELD IL`, between(14, 130));
  if (m === '2026-06') addOrchard(m, day(m, 20), 'NAMECHEAP.COM PHOENIX AZ', 11.28);
  addOrchard(m, day(m, 9), 'OPENROUTER, INC NEW YORK NY', 20);
  if (m === '2026-08') addOrchard(m, day(m, 4), 'Payment Thank You-Mobile', -210);                       // card leg with no bank leg: shows under Accounts and data

  // ----- Pebble Card (card export with its own categories) -----
  for (let i = 0; i < 3; i++) addPebble(day(m, int(1, 28)), pick(['Trader Joes', 'Whole Foods Market', 'Publix']), 'Grocery', between(30, 120));
  for (let i = 0; i < 2; i++) addPebble(day(m, int(1, 28)), pick(['Chevron', 'Exxon']), 'Gas', between(28, 55));
  for (let i = 0; i < 2; i++) addPebble(day(m, int(1, 28)), pick(['Chipotle', 'Panera Bread', 'Starbucks']), 'Restaurants', between(8, 32));
  addPebble(day(m, 20), 'Geico', 'Insurance', 118.4);
  addPebble(day(m, 17), 'Apple Services', 'Other', 10.99, 'APPLE.COM/BILL ONE APPLE PARK WAY CUPERTINO 95014 CA USA');
  addPebble(day(m, int(1, 28)), 'Mystery Gadget Shop', 'Shopping', between(20, 80));
  addPebble(day(m, 27), 'Daily Cash Redemption', 'Rewards', -between(3, 9), 'DAILY CASH ADJUSTMENT', 'Payment');
}

// the mid-September checking payment has no card leg yet; the card statement ends before it
addChk('2026-09', day('2026-09', 15), 'Mobile Banking payment to CRD 2222', -75);

const byDate = <T extends { date: string }>(xs: T[]) => xs.sort((x, y) => x.date.localeCompare(y.date));
const write = (name: string, data: unknown) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 1) + '\n');
write('raw/bank1111.json', byDate(chk));
write('raw/card2222.json', byDate(harborRows));
write('raw/visa3333.json', byDate(orchardRows));
write('raw/pebble.json', byDate(pebbleRows));

write('accounts.json', {
  windowStart: '2026-06-01',
  accounts: [
    { id: 'northwind-chk-1111', name: 'Northwind checking', institution: 'Northwind Bank', type: 'checking', last4: '1111', coverage: COVER.chk, incomeComplete: false, source: { format: 'bank', file: 'bank1111.json', label: 'Northwind checking' } },
    { id: 'harbor-card-2222', name: 'Harbor Rewards card', institution: 'Harbor Credit', type: 'credit', last4: '2222', coverage: COVER.harbor, source: { format: 'card', file: 'card2222.json', label: 'Harbor card' } },
    { id: 'orchard-visa-3333', name: 'Orchard Visa', institution: 'Orchard Bank', type: 'credit', last4: '3333', coverage: COVER.orchard, source: { format: 'card_orders', file: 'visa3333.json', label: 'Orchard statement' } },
    { id: 'pebble-card', name: 'Pebble Card', institution: 'Pebble', type: 'credit', last4: '4444', coverage: COVER.pebble, source: { format: 'apple', file: 'pebble.json', label: 'Pebble card export' } },
    { id: 'cash', name: 'Cash', institution: '', type: 'cash', last4: '', coverage: { from: '2026-06-01', to: '2099-12-31' } },
  ],
});
console.log(`sample statements written: bank ${chk.length}, harbor ${harborRows.length}, orchard ${orchardRows.length}, pebble ${pebbleRows.length}`);
