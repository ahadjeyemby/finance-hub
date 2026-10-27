// Fictional ledgers for local development and tests. Every merchant, person and amount here is invented; nothing is taken from real statements
// or from the design reference files. The app loads one only in a development build with no backend configured and EXPO_PUBLIC_FIXTURE set
// (see data/repo.tsx): a real database is never mixed with, or replaced by, these rows.
//
//   full   four complete months and a partial fifth, every dashboard widget has something to show (some still need answers, on purpose)
//   gapped the same, with one card's August statement missing, so that month is not complete
//   sparse eight days of one card, so most widgets are in their "needs more data" state
//   empty  accounts with statements but no charges at all
import { summarizeRecurring } from '@/core/recurring';
import { emptyOverlay } from '@/core/types';
import type { Account, Hint, Overlay, StatementPeriod, Txn } from '@/core/types';

export type FixtureKind = 'full' | 'gapped' | 'sparse' | 'empty';
export interface Fixture { accounts: Account[]; txns: Txn[]; statements: StatementPeriod[]; overlay: Overlay }

const CHK = 'juniper-chk-0101';
const CARD_A = 'meadow-card-0202';
const CARD_B = 'tidewater-visa-0303';

const ACCOUNTS: Account[] = [
  { id: CHK, name: 'Juniper checking', institution: 'Juniper Bank', type: 'checking', last4: '0101', coverage: { from: '2026-06-01', to: '2026-10-12' }, incomeComplete: true },
  { id: CARD_A, name: 'Meadow Rewards card', institution: 'Meadow Credit', type: 'credit', last4: '0202', coverage: { from: '2026-06-01', to: '2026-10-12' } },
  { id: CARD_B, name: 'Tidewater Visa', institution: 'Tidewater Bank', type: 'credit', last4: '0303', coverage: { from: '2026-06-01', to: '2026-10-10' } },
  { id: 'cash', name: 'Cash', institution: '', type: 'cash', last4: '', coverage: { from: '2026-06-01', to: '2099-12-31' } },
];

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay: Record<string, string> = { '2026-06': '30', '2026-07': '31', '2026-08': '31', '2026-09': '30', '2026-10': '31' };

/** a small deterministic generator, so every run gives the same ledger */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Opts { category?: string; hints?: Hint[]; business?: boolean; oneOff?: boolean; kind?: Txn['kind']; subtype?: string; lines?: { item: string; cents: number }[]; pairId?: string; description?: string }

function build(kind: FixtureKind): Fixture {
  const rand = rng(20261022);
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100);
  const txns: Txn[] = [];
  const add = (accountId: string, date: string, merchant: string, cents: number, o: Opts = {}) => {
    const id = `${accountId}:${date}:${cents}:${slug(merchant)}:${txns.length}`;
    txns.push({
      id, accountId, date, description: (o.description ?? merchant).toUpperCase(), merchant, cents, kind: o.kind ?? 'spend', source: `fixture ${kind}`,
      ...(o.subtype ? { subtype: o.subtype } : {}), ...(o.category ? { category: o.category } : {}), ...(o.hints ? { hints: o.hints } : {}),
      ...(o.business !== undefined ? { business: o.business } : {}), ...(o.oneOff !== undefined ? { oneOff: o.oneOff } : {}),
      ...(o.lines ? { lines: o.lines } : {}), ...(o.pairId ? { pairId: o.pairId } : {}),
    });
    return id;
  };

  if (kind === 'sparse') {
    const days = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const d of days) {
      if (d % 2) add(CARD_A, `2026-10-${pad(d)}`, 'Copper Kettle Diner', -between(14, 32), { category: 'restaurants' });
      if (d === 3) add(CARD_A, `2026-10-${pad(d)}`, 'Greenleaf Grocers', -between(40, 70), { category: 'groceries' });
      if (d === 6) add(CARD_A, `2026-10-${pad(d)}`, 'Cobalt Fuel', -between(38, 52), { category: 'fuel' });
    }
    const accounts = [{ ...ACCOUNTS[1], coverage: { from: '2026-10-01', to: '2026-10-08' } }];
    return { accounts, txns, statements: [{ accountId: CARD_A, from: '2026-10-01', to: '2026-10-08' }], overlay: emptyOverlay() };
  }

  const statements: StatementPeriod[] = [];
  for (const a of ACCOUNTS.filter((x) => x.type !== 'cash')) {
    for (const m of MONTHS) {
      const to = m === '2026-10' ? a.coverage.to : `${m}-${lastDay[m]}`;
      if (kind === 'gapped' && a.id === CARD_B && m === '2026-08') continue;
      statements.push({ accountId: a.id, from: `${m}-01`, to });
    }
  }
  if (kind === 'empty') return { accounts: ACCOUNTS, txns, statements, overlay: emptyOverlay() };

  const groceryPrices: Record<string, Record<string, number>> = {
    'Tomatoes, lb': { 'FreshHarbor Market': 189, 'Greenleaf Grocers': 149, 'ValuCo Foods': 119 },
    'Onions, lb': { 'FreshHarbor Market': 129, 'Greenleaf Grocers': 109, 'ValuCo Foods': 99 },
    'Milk, gallon': { 'FreshHarbor Market': 379, 'Greenleaf Grocers': 349, 'ValuCo Foods': 319 },
    'Basmati rice, 10 lb': { 'FreshHarbor Market': 2499, 'ValuCo Foods': 2149 },
    'Eggs, dozen': { 'FreshHarbor Market': 329, 'Greenleaf Grocers': 289, 'ValuCo Foods': 249 },
    'Bananas, lb': { 'FreshHarbor Market': 69, 'Greenleaf Grocers': 59 },
    'Sourdough loaf': { 'FreshHarbor Market': 549 },
    'Spinach, bag': { 'Greenleaf Grocers': 299 },
  };
  const basketAt = (store: string) => {
    const lines: { item: string; cents: number }[] = [];
    for (const [item, prices] of Object.entries(groceryPrices)) {
      const p = prices[store];
      if (p == null || rand() < 0.3) continue;
      const qty = item.includes('rice') ? 1 : 1 + Math.floor(rand() * 2);
      for (let i = 0; i < qty; i++) lines.push({ item, cents: p });
    }
    return lines;
  };

  for (const m of MONTHS) {
    const partial = m === '2026-10';
    const upTo = partial ? 12 : Number(lastDay[m]);
    const d = (day: number) => `${m}-${pad(day)}`;
    const on = (day: number) => day <= upTo;

    // fixed bills
    if (on(1)) add(CHK, d(1), 'Maple Court Apartments', -145000, { category: 'housing', description: 'MAPLE COURT APARTMENTS RENT PAYMENT' });
    if (on(18)) add(CHK, d(18), 'Riverside Power & Water', -between(82, 118), { category: 'utilities' });
    if (on(9)) add(CARD_A, d(9), 'Northpeak Mobile', -6400, { category: 'phone' });
    if (on(14)) add(CARD_A, d(14), 'StreamBox', -1599, { category: 'subscriptions' });
    if (on(3)) add(CARD_B, d(3), 'Cloudnest Hosting', -1200, { category: 'subscriptions', hints: ['business_or_personal'] });
    if (on(21)) add(CARD_B, d(21), 'Pixelforge Design', -900, { category: 'subscriptions', hints: ['business_or_personal'] });
    if (on(11)) add(CARD_B, d(11), 'Ledgerly Pro', -1800, { category: 'subscriptions', business: true });
    if (on(6)) add(CARD_B, d(6), 'Coworking Hub', -15000, { category: 'other', business: true });
    if (on(25)) add(CHK, d(25), 'Open Hands Food Bank', -2500, { category: 'giving' });

    // groceries with receipts
    const grocery = (day: number, store: string, acct: string) => { if (!on(day)) return; const lines = basketAt(store); add(acct, d(day), store, -lines.reduce((s, l) => s + l.cents, 0), { category: 'groceries', lines }); };
    grocery(2, 'FreshHarbor Market', CARD_A); grocery(16, 'FreshHarbor Market', CARD_A);
    grocery(9, 'Greenleaf Grocers', CARD_A); grocery(23, 'Greenleaf Grocers', CARD_A);
    grocery(27, 'ValuCo Foods', CARD_B);

    // big-box stores: no item detail
    for (const day of [4, 19]) if (on(day)) add(CARD_B, d(day), 'Lindenmart', -between(80, 180), { category: 'mixed_retail', hints: ['needs_items'] });
    if (on(12)) add(CARD_A, d(12), 'Bulkway Club', -between(120, 220), { category: 'mixed_retail', hints: ['needs_items'] });
    if (on(24)) add(CARD_B, d(24), 'MegaSave Warehouse', -between(90, 160), { category: 'mixed_retail', hints: ['needs_items'] });

    // fuel: August has a road trip
    const fills = m === '2026-08' ? [2, 5, 9, 12, 16, 19, 23, 26, 30] : [5, 12, 19, 26];
    for (const day of fills) if (on(day)) add(day % 2 ? CARD_A : CARD_B, d(day), day % 2 ? 'Cobalt Fuel' : 'Summit Gas', -between(36, 55), { category: 'fuel' });

    // medical
    if (on(8)) add(CARD_A, d(8), 'Pinecrest Pharmacy', -between(18, 40), { category: 'medical' });
    if (m === '2026-08') add(CARD_A, d(20), 'Riverbend Clinic', -14000, { category: 'medical' });
    if (m === '2026-09') add(CARD_A, d(15), 'Riverbend Clinic', -9500, { category: 'medical' });

    // everything else
    for (const day of [3, 10, 17, 24]) if (on(day)) add(CARD_A, d(day), 'Copper Kettle Diner', -between(18, 45), { category: 'restaurants' });
    for (const day of [7, 21]) if (on(day)) add(CARD_B, d(day), 'Saffron Lane', -between(30, 62), { category: 'restaurants' });
    for (const day of [6, 22]) if (on(day)) add(CARD_B, d(day), 'ParcelPoint Online', -between(25, 90), { category: 'online_shopping' });
    if (on(13)) add(CARD_A, d(13), 'Starlight Cinema', -between(22, 30), { category: 'entertainment' });
    if (m === '2026-07') add(CARD_A, d(11), 'Glow Salon', -5500, { category: 'personal_care' });
    if (m === '2026-09') add(CARD_B, d(5), 'Thread & Needle', -12000, { category: 'clothing' });
    if (m === '2026-08') add(CARD_A, d(28), 'QuickLane Auto Care', -21000, { category: 'auto' });

    // income: pay every other Friday, a business client each month
    for (const day of ({ '2026-06': [5, 19], '2026-07': [3, 17, 31], '2026-08': [14, 28], '2026-09': [11, 25], '2026-10': [9] } as Record<string, number[]>)[m])
      add(CHK, d(day), 'Brightline Payroll', 214055, { kind: 'income', subtype: 'salary', description: 'BRIGHTLINE PAYROLL DIRECT DEP' });
    if (on(15)) add(CHK, d(15), 'Fernleaf Studio', between(560, 760), { kind: 'income', subtype: 'other', description: 'FERNLEAF STUDIO CLIENT PAYMENT' });

    // card payments: Meadow is paid from checking (both sides seen); Tidewater from an account the app cannot see (only the card side)
    if (on(20) || partial) {
      const day = partial ? 10 : 20;
      const amt = between(900, 1300);
      const a = `${CHK}:${d(day)}:-${amt}:pay`;
      const b = `${CARD_A}:${d(day)}:${amt}:pay`;
      txns.push({ id: a, accountId: CHK, date: d(day), description: 'MEADOW CREDIT PAYMENT', merchant: 'Meadow Credit payment', cents: -amt, kind: 'transfer', subtype: 'card_payment', pairId: b, source: `fixture ${kind}` });
      txns.push({ id: b, accountId: CARD_A, date: d(day), description: 'PAYMENT THANK YOU', merchant: 'Payment', cents: amt, kind: 'transfer', subtype: 'card_payment', pairId: a, source: `fixture ${kind}` });
    }
    if (on(26)) add(CARD_B, d(26), 'Payment', between(700, 1000), { kind: 'transfer', subtype: 'card_payment', description: 'ONLINE PAYMENT RECEIVED' });
  }

  // things that only happen once
  add(CARD_A, '2026-06-18', 'Skyway Travel Agency', -238000, { category: 'travel', hints: ['large_one_off'] });
  add(CARD_A, '2026-08-08', 'Bluewater Lodge', -64000, { category: 'travel', oneOff: true });
  add(CHK, '2026-07-20', 'Little Acorns Preschool', -17500, { category: 'education' });
  add(CHK, '2026-09-25', 'Harborview Auto Insurance', -9640, { category: 'insurance' });
  add(CARD_B, '2026-07-09', 'Restock Supply Co.', -18000, { category: 'other', hints: ['business_or_personal'] });
  add(CARD_B, '2026-09-14', 'Restock Supply Co.', -16450, { category: 'other', hints: ['business_or_personal'] });
  add(CHK, '2026-09-22', 'Mobile deposit', 30000, { kind: 'income', subtype: 'unconfirmed', description: 'MOBILE DEPOSIT' });
  add(CARD_A, '2026-08-30', 'Meadow cash back', 2500, { kind: 'rewards', description: 'CASH BACK REDEMPTION' });
  add(CARD_B, '2026-09-16', 'ParcelPoint Online', 2500, { kind: 'refund', category: 'online_shopping', description: 'PARCELPOINT ONLINE REFUND' });
  add(CHK, '2026-08-21', 'Transfer to savings', -20000, { kind: 'transfer', subtype: 'internal', description: 'TRANSFER TO SAV 9090' });

  txns.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // the person has already said a few things: rent and phone are confirmed bills, and Fernleaf Studio is a business income source
  const overlay = emptyOverlay();
  const rec = summarizeRecurring(txns, undefined, '2026-10-12');
  overlay.recurring = { edits: Object.fromEntries(rec.items.filter((i) => /Maple Court|Northpeak/.test(i.merchant)).map((i) => [i.key, { status: 'confirmed' as const }])), manual: [] };
  overlay.income = { sources: [{ id: 'src-brightline', name: 'Brightline', type: 'salary', words: ['brightline'] }, { id: 'src-fernleaf', name: 'Fernleaf Studio', type: 'business', words: ['fernleaf'] }], records: [], assign: {} };
  return { accounts: ACCOUNTS, txns, statements, overlay };
}

const cache = new Map<FixtureKind, Fixture>();
export function fixture(kind: FixtureKind = 'full'): Fixture {
  if (!cache.has(kind)) cache.set(kind, build(kind));
  return cache.get(kind)!;
}

export const isFixtureKind = (v: unknown): v is FixtureKind => v === 'full' || v === 'gapped' || v === 'sparse' || v === 'empty';
