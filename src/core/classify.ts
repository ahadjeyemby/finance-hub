import type { Account, Hint, Kind, Txn } from './types';
import { APPLE_CATEGORY_MAP, matchMerchant, titleCase } from './merchants';

// ---------- raw rows (what scripts/extract/statements.py writes) ----------
export interface RawBank { statement: string; date: string; description: string; amount: number }
export interface RawCard { statement: string; section: 'pay' | 'pur'; date: string; description: string; amount: number }
export interface RawChase { statement: string; date: string; description: string; amount: number; order: string | null }
export interface RawApple { date: string; description: string; merchant: string; appleCategory: string; type: string; amount: number }

export const toCents = (dollars: number) => Math.round(dollars * 100);

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** Stable id so re-importing the same statement never duplicates a row. */
export function makeId(accountId: string, date: string, cents: number, description: string, seen: Map<string, number>) {
  const base = `${accountId}:${date}:${cents}:${slug(description)}`;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}#${n}`;
}

interface Base {
  accountId: string; date: string; description: string; cents: number; source: string; ref?: string;
}

/**
 * The single place that decides what a row IS.
 * Order of checks matters: money moving between your own accounts is recognised first,
 * so a card payment can never be counted as income on the card or spending on the bank.
 */
export function classifyRow(b: Base, ctx: { appleCategory?: string; type: Account['type'] }): Omit<Txn, 'id'> {
  const d = b.description;
  const dl = d.toLowerCase();
  const out: Omit<Txn, 'id'> = {
    accountId: b.accountId, date: b.date, description: d, merchant: titleCase(d.split(/\s{2,}| DES:| ID:/)[0]).slice(0, 40),
    cents: b.cents, kind: 'spend', source: b.source, ref: b.ref,
  };

  // ---- transfers between your own accounts / card payments ----
  if (/payment to crd \d{4}|payment to chase card|bank of america\s+payment|applecard gsbank|payment thank you|payment from chk|online\/mobile payment|ach deposit internet transfer/.test(dl)) {
    return { ...out, kind: 'transfer', subtype: 'card_payment', merchant: 'Card payment' };
  }
  if (/online banking transfer to chk/.test(dl)) {
    return { ...out, kind: 'transfer', subtype: 'internal', merchant: 'Transfer to own account', hints: ['confirm_transfer_account'] };
  }

  // ---- money in ----
  if (/daily cash redemption|cashreward/.test(dl)) {
    return { ...out, kind: 'rewards', subtype: 'cash_back', merchant: /cashreward/.test(dl) ? 'Bank of America rewards' : 'Apple Daily Cash' };
  }
  if (/payroll/.test(dl)) {
    return { ...out, kind: 'income', subtype: 'salary', merchant: 'Payroll' };
  }
  if (ctx.type === 'checking' && b.cents > 0) {
    if (/mobile/.test(dl) && /deposit/.test(dl)) {
      return { ...out, kind: 'income', subtype: 'unconfirmed', merchant: 'Mobile check deposit', hints: ['confirm_income'] };
    }
    // Statement shows the amount but the description is blacked out. A repeating
    // same-amount deposit is almost certainly payroll, so label it "probably" and ask.
    return { ...out, kind: 'income', subtype: 'unconfirmed', merchant: 'Deposit', hints: ['confirm_income'] };
  }

  // ---- merchant credits (refunds) ----
  const rule = matchMerchant(d);
  if (b.cents > 0 && ctx.type === 'credit') {
    return {
      ...out, kind: 'refund', merchant: rule?.merchant ?? out.merchant,
      category: rule?.category ?? 'uncategorized', subcategory: rule?.subcategory,
    };
  }

  // ---- person-to-person ----
  if (/zelle payment to/.test(dl)) {
    const who = titleCase(d.replace(/.*zelle payment to\s+/i, '').replace(/\s+conf#.*/i, ''));
    return { ...out, kind: 'spend', merchant: `Zelle: ${who}`, category: 'people', hints: ['person_payment'] };
  }

  // ---- everything else is spending ----
  let category = rule?.category;
  const hints: Hint[] = [...(rule?.hints ?? [])];
  if (!category && ctx.appleCategory && APPLE_CATEGORY_MAP[ctx.appleCategory]) category = APPLE_CATEGORY_MAP[ctx.appleCategory];
  if (!category) { category = 'uncategorized'; if (!hints.includes('unknown_merchant')) hints.push('unknown_merchant'); }
  if (Math.abs(b.cents) >= 100000 && !hints.includes('large_one_off')) hints.push('large_one_off');
  return {
    ...out, kind: 'spend', merchant: rule?.merchant ?? out.merchant, category,
    subcategory: rule?.subcategory, business: rule?.business, hints: hints.length ? hints : undefined,
  };
}

/** Pair the two legs of every card payment: bank outflow vs card inflow, same amount, within 6 days. */
export function pairTransfers(txns: Txn[]): { paired: number; unmatchedCardPayments: Txn[]; unmatchedBankOut: Txn[] } {
  const bankOut = txns.filter((t) => t.kind === 'transfer' && t.subtype === 'card_payment' && t.cents < 0);
  const cardIn = txns.filter((t) => t.kind === 'transfer' && t.subtype === 'card_payment' && t.cents > 0);
  const used = new Set<string>();
  let paired = 0;
  const dayMs = 86400000;
  for (const c of cardIn.sort((a, b) => a.date.localeCompare(b.date))) {
    const cand = bankOut
      .filter((o) => !used.has(o.id) && o.cents === -c.cents && Math.abs(Date.parse(o.date) - Date.parse(c.date)) <= 6 * dayMs)
      .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(c.date)) - Math.abs(Date.parse(b.date) - Date.parse(c.date)))[0];
    if (cand) { used.add(cand.id); c.pairId = cand.id; cand.pairId = c.id; paired++; }
  }
  return {
    paired,
    unmatchedCardPayments: cardIn.filter((c) => !c.pairId),
    unmatchedBankOut: bankOut.filter((o) => !o.pairId),
  };
}

export const KIND_LABEL: Record<Kind, string> = {
  spend: 'Spending', fee: 'Fee', refund: 'Refund', income: 'Income', rewards: 'Rewards', transfer: 'Transfer',
};
