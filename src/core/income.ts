// Income: where money comes from, and what was taken out of it before it arrived. Pure TypeScript: no React, no network, no model.
//
// Bank statements show only what landed (a deposit with a blank or generic description), so three things are kept here on top of them:
//   - sources: the person's own list of where income comes from (a job, a business, dividends, rent), each with words that identify its deposits;
//   - pay records: one per paycheck or payout, with the gross, the taxes and deductions taken out, the net and where it was deposited. Every record
//     must add up before it is saved, and each deposit it names is looked for on the statements, which proves the deposit and ties it to its source;
//   - the taxes seen from three places that are never merged into one figure: withheld from pay (records), paid from a bank account (statements)
//     and sales tax printed on receipts.
// Nothing here works out tax owed, capital gains or advice. It records what the documents and statements show.
import { hasNumber } from './accounts';
import type { Account, Txn } from './types';

export type IncomeType = 'salary' | 'business' | 'investment' | 'interest' | 'rental' | 'other';
export const INCOME_TYPES: IncomeType[] = ['salary', 'business', 'investment', 'interest', 'rental', 'other'];
export const INCOME_TYPE_LABEL: Record<IncomeType, string> = { salary: 'Salary or wages', business: 'Business', investment: 'Investments (dividends, sales)', interest: 'Interest', rental: 'Rental', other: 'Other' };

export interface IncomeSource { id: string; name: string; type: IncomeType; /** words in a deposit's description that mark it as this source, lower case */ words: string[] }
export interface PayLine { label: string; cents: number }
export interface PayDeduction extends PayLine { group: 'insurance' | 'retirement' | 'other' }
export interface DepositLine { /** last four digits of the account it went to; empty when the document does not say */ last4?: string; cents: number }
export interface PayRecord {
  id: string; sourceId: string;
  /** the day the money was paid */
  date: string; periodFrom?: string; periodTo?: string;
  grossCents: number; taxes: PayLine[]; deductions: PayDeduction[]; netCents: number;
  deposits: DepositLine[]; note?: string;
}
export interface IncomeState {
  sources: IncomeSource[]; records: PayRecord[];
  /** a deposit the person assigned to a source by hand, by transaction id */
  assign: Record<string, string>;
}
export const emptyIncome = (): IncomeState => ({ sources: [], records: [], assign: {} });
const copy = (s?: IncomeState): IncomeState => ({ sources: [...(s?.sources ?? [])], records: [...(s?.records ?? [])], assign: { ...(s?.assign ?? {}) } });
export const newIncomeId = (prefix: string, existing: { id: string }[]) => `${prefix}${Date.now().toString(36)}${existing.length}`;

const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);
const dayGap = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));
const money = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;

// ---------------------------------------------------------------------------
// A record must add up
// ---------------------------------------------------------------------------
/** What is wrong with a pay record, in plain words. An empty list means it adds up. Nothing is ever adjusted to make it fit. */
export function recordIssues(r: PayRecord): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date))) out.push('The pay date is not a date (YYYY-MM-DD).');
  if (!(r.grossCents > 0)) out.push('Gross pay must be more than zero.');
  if (!(r.netCents > 0)) out.push('Net pay must be more than zero.');
  if ([...r.taxes, ...r.deductions].some((l) => !(l.cents > 0))) out.push('Every tax and deduction amount must be more than zero. Enter them as positive numbers.');
  const taken = sum(r.taxes) + sum(r.deductions);
  const gap = r.grossCents - taken - r.netCents;
  if (gap !== 0) out.push(`Gross ${money(r.grossCents)} minus taxes and deductions ${money(taken)} is ${money(r.grossCents - taken)}, but net pay is ${money(r.netCents)} (${money(gap)} ${gap > 0 ? 'unaccounted for' : 'too much taken out'}).`);
  if (r.deposits.length && sum(r.deposits) !== r.netCents) out.push(`The deposits add up to ${money(sum(r.deposits))} but net pay is ${money(r.netCents)}.`);
  return out;
}

// ---------------------------------------------------------------------------
// Finding the deposits on the statements
// ---------------------------------------------------------------------------
export interface DepositMatch { line: DepositLine; txnId: string | null }
const WINDOW_DAYS = 4;

/** Where each deposit of a record landed on the statements: same amount, an account with that last four, within a few days of the pay date. */
export function matchRecord(r: PayRecord, txns: Txn[], accounts: Account[], used: Set<string> = new Set()): DepositMatch[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const taken = new Set(used);
  return r.deposits.map((line) => {
    const hit = txns
      .filter((t) => t.kind === 'income' && t.cents === line.cents && !taken.has(t.id) && dayGap(t.date, r.date) <= WINDOW_DAYS
        && (!line.last4 || (byId.get(t.accountId) && hasNumber(byId.get(t.accountId)!, line.last4))))
      .sort((a, b) => dayGap(a.date, r.date) - dayGap(b.date, r.date))[0];
    if (hit) taken.add(hit.id);
    return { line, txnId: hit?.id ?? null };
  });
}

/** Every record's matches, no deposit used twice, oldest record first. */
export function matchAll(records: PayRecord[], txns: Txn[], accounts: Account[]): Map<string, DepositMatch[]> {
  const used = new Set<string>(); const out = new Map<string, DepositMatch[]>();
  for (const r of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
    const m = matchRecord(r, txns, accounts, used);
    m.forEach((x) => { if (x.txnId) used.add(x.txnId); });
    out.set(r.id, m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which source a deposit belongs to
// ---------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase();

/**
 * The source of each income deposit: the person's own assignment first, then a pay record that names the deposit, then the source's words found
 * in the description. Anything else is left unassigned (null), never guessed.
 */
export function attribute(txns: Txn[], state: IncomeState, accounts: Account[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const live = new Set(state.sources.map((s) => s.id));
  const fromRecord = new Map<string, string>();
  // one deposit can only be claimed by one record, so the matching is done across all records together
  const global = matchAll(state.records, txns, accounts);
  for (const r of state.records) for (const m of global.get(r.id) ?? []) if (m.txnId) fromRecord.set(m.txnId, r.sourceId);
  for (const t of txns) {
    if (t.kind !== 'income') continue;
    const manual = state.assign[t.id];
    if (manual && live.has(manual)) { out.set(t.id, manual); continue; }
    const rec = fromRecord.get(t.id);
    if (rec && live.has(rec)) { out.set(t.id, rec); continue; }
    const text = norm(`${t.description} ${t.merchant}`);
    const hit = state.sources.find((s) => s.words.some((w) => w && text.includes(norm(w))));
    out.set(t.id, hit?.id ?? null);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Taxes from the statements and the receipts
// ---------------------------------------------------------------------------
/** A payment to a tax authority, judged from the bank's description. Shown as a list to check, never added to anything silently. */
export const isTaxPayment = (t: Txn) => (t.kind === 'spend' || t.kind === 'fee') && t.cents < 0
  && /\b(irs|us treasury|treas|usataxpymt|dept of revenue|department of revenue|franchise tax|state tax|tax pymt|tax payment|estimated tax|property tax|tax collector)\b/i.test(`${t.description} ${t.merchant}`);

export interface ReceiptTax { date: string | null; taxCents: number | null }

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------
export interface SourceSummary {
  source: IncomeSource | null;
  depositsCents: number; count: number;
  /** deposits that a pay record accounts for, in cents */
  provenCents: number;
  records: number; grossCents: number; taxCents: number; deductionCents: number; netCents: number;
  /** taxes over gross across the records in the period, null with no records */
  taxRate: number | null;
}
export interface IncomeSummary {
  totalCents: number;
  sources: SourceSummary[];
  /** deposits with no source, to assign */
  unassigned: Txn[];
  /** taken from pay before it arrives, by what the record calls it */
  withheld: { label: string; cents: number }[];
  withheldCents: number;
  insuranceCents: number; retirementCents: number;
  /** paid from a bank account, judged from the description */
  paid: { cents: number; txns: Txn[] };
  /** sales tax printed on the receipts that were imported: a floor, not the whole */
  salesTaxCents: number; salesTaxReceipts: number;
}

const inRange = (d: string | null, from: string, to: string) => !!d && d >= from && d <= to;

export function summarizeIncome(txns: Txn[], accounts: Account[], state: IncomeState | undefined, range: { from: string; to: string }, receipts: ReceiptTax[] = []): IncomeSummary {
  const st = state ?? emptyIncome();
  const attr = attribute(txns, st, accounts);
  const matches = matchAll(st.records, txns, accounts);
  const deposits = txns.filter((t) => t.kind === 'income' && inRange(t.date, range.from, range.to));
  const bySource = new Map<string | null, SourceSummary>();
  const row = (id: string | null) => {
    if (!bySource.has(id)) bySource.set(id, { source: st.sources.find((s) => s.id === id) ?? null, depositsCents: 0, count: 0, provenCents: 0, records: 0, grossCents: 0, taxCents: 0, deductionCents: 0, netCents: 0, taxRate: null });
    return bySource.get(id)!;
  };
  for (const s of st.sources) row(s.id);
  const proven = new Set<string>();
  for (const ms of matches.values()) for (const m of ms) if (m.txnId) proven.add(m.txnId);
  for (const t of deposits) { const r = row(attr.get(t.id) ?? null); r.depositsCents += t.cents; r.count++; if (proven.has(t.id)) r.provenCents += t.cents; }

  const recs = st.records.filter((r) => inRange(r.date, range.from, range.to));
  const withheld = new Map<string, number>();
  let insurance = 0, retirement = 0;
  for (const r of recs) {
    const x = row(st.sources.some((s) => s.id === r.sourceId) ? r.sourceId : null);
    x.records++; x.grossCents += r.grossCents; x.taxCents += sum(r.taxes); x.deductionCents += sum(r.deductions); x.netCents += r.netCents;
    for (const l of r.taxes) { const k = l.label.trim() || 'Tax'; withheld.set(k, (withheld.get(k) ?? 0) + l.cents); }
    for (const d of r.deductions) { if (d.group === 'insurance') insurance += d.cents; if (d.group === 'retirement') retirement += d.cents; }
  }
  const sources = [...bySource.values()].filter((s) => s.source || s.depositsCents || s.records).map((s) => ({ ...s, taxRate: s.grossCents > 0 ? s.taxCents / s.grossCents : null }));
  sources.sort((a, b) => Number(!a.source) - Number(!b.source) || b.depositsCents - a.depositsCents);

  const taxTxns = txns.filter((t) => isTaxPayment(t) && inRange(t.date, range.from, range.to));
  const rec = receipts.filter((r) => inRange(r.date, range.from, range.to) && (r.taxCents ?? 0) > 0);
  return {
    totalCents: sum(deposits), sources, unassigned: deposits.filter((t) => !attr.get(t.id)).sort((a, b) => b.date.localeCompare(a.date)),
    withheld: [...withheld].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents), withheldCents: [...withheld.values()].reduce((s, c) => s + c, 0),
    insuranceCents: insurance, retirementCents: retirement,
    paid: { cents: -sum(taxTxns), txns: taxTxns }, salesTaxCents: rec.reduce((s, r) => s + (r.taxCents ?? 0), 0), salesTaxReceipts: rec.length,
  };
}

// ---------------------------------------------------------------------------
// Changes the person makes
// ---------------------------------------------------------------------------
export function parseWords(text: string): string[] { return [...new Set(text.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean))]; }

export function saveSource(s: IncomeState | undefined, source: IncomeSource): IncomeState {
  const next = copy(s);
  const clean = { ...source, name: source.name.trim(), words: parseWords(source.words.join(',')) };
  const i = next.sources.findIndex((x) => x.id === clean.id);
  if (i >= 0) next.sources[i] = clean; else next.sources.push(clean);
  return next;
}
/** A source that still has records cannot be removed: its history would lose its meaning. Returns null then. */
export function removeSource(s: IncomeState | undefined, id: string): IncomeState | null {
  const next = copy(s);
  if (next.records.some((r) => r.sourceId === id)) return null;
  next.sources = next.sources.filter((x) => x.id !== id);
  for (const [k, v] of Object.entries(next.assign)) if (v === id) delete next.assign[k];
  return next;
}
/** Save a record only when it adds up: a record with issues is returned unchanged with the reasons. */
export function saveRecord(s: IncomeState | undefined, record: PayRecord): { state: IncomeState; issues: string[] } {
  const issues = recordIssues(record);
  if (issues.length) return { state: copy(s), issues };
  if (!(s?.sources ?? []).some((x) => x.id === record.sourceId)) return { state: copy(s), issues: ['Choose which income source this is.'] };
  const next = copy(s);
  const i = next.records.findIndex((x) => x.id === record.id);
  if (i >= 0) next.records[i] = record; else next.records.push(record);
  return { state: next, issues: [] };
}
export function removeRecord(s: IncomeState | undefined, id: string): IncomeState { const next = copy(s); next.records = next.records.filter((r) => r.id !== id); return next; }
export function assignDeposit(s: IncomeState | undefined, txnId: string, sourceId: string | null): IncomeState {
  const next = copy(s);
  if (sourceId) next.assign[txnId] = sourceId; else delete next.assign[txnId];
  return next;
}
