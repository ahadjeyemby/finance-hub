import { CATEGORIES } from './categories';
import type { Overlay, Question, Txn } from './types';

const catChoices = CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => ({ value: c.id, label: c.label }));
const BP = [{ value: 'personal', label: 'Personal' }, { value: 'business', label: 'Business' }];

/**
 * Build the inbox of questions. Rules:
 *  - one question per merchant, not per transaction (answering can apply to all)
 *  - skip anything already answered
 *  - sorted by dollars at stake so the first questions are the ones that matter
 *  - never ask about a charge under $5 unless it repeats (noise kills the habit)
 */
export function buildQuestions(txns: Txn[], overlay: Pick<Overlay, 'answered'>): Question[] {
  const out: Question[] = [];
  const answered = overlay.answered;
  const push = (q: Question) => { if (!answered[q.id]) out.push(q); };

  // income that needs confirming
  const unconfirmed = txns.filter((t) => t.kind === 'income' && t.subtype === 'unconfirmed');
  const byAmt = new Map<number, Txn[]>();
  for (const t of unconfirmed) byAmt.set(t.cents, [...(byAmt.get(t.cents) ?? []), t]);
  for (const [cents, ts] of byAmt) {
    const repeats = ts.length > 1;
    push({
      id: `income:${cents}`, type: 'confirm_income', txnIds: ts.map((t) => t.id), merchant: ts[0].merchant, cents: cents * ts.length,
      prompt: repeats ? `A deposit of $${(cents / 100).toFixed(2)} arrived ${ts.length} times (${ts.map((t) => t.date.slice(5)).join(', ')}). What is it?` : `What was the $${(cents / 100).toFixed(2)} deposit on ${ts[0].date}?`,
      detail: 'The bank statement hides the sender. It counts as earned for now. If it is a reimbursement or a move from your own account, your answer removes it from Earned.',
      choices: [{ value: 'salary', label: 'Salary / payroll' }, { value: 'other', label: 'Other income' }, { value: 'reimbursement', label: 'Reimbursement (not income)' }, { value: 'transfer', label: 'Move from my own account' }],
      canApplyToMerchant: false,
    });
  }

  // transfers to accounts we cannot see
  for (const t of txns.filter((t) => t.kind === 'transfer' && t.subtype === 'internal'))
    push({
      id: `xfer:${t.id}`, type: 'transfer_account', txnIds: [t.id], merchant: t.merchant, cents: Math.abs(t.cents),
      prompt: `$${(Math.abs(t.cents) / 100).toFixed(2)} moved to another account on ${t.date}. Is that your own account?`,
      detail: 'If it is yours, it stays out of spending. Adding that account\'s statements will show what happened to the money.',
      choices: [{ value: 'own', label: 'Yes, my own account' }, { value: 'spend', label: 'No, I paid someone' }],
      canApplyToMerchant: false,
    });

  // person-to-person payments
  for (const t of txns.filter((t) => t.hints?.includes('person_payment')))
    push({
      id: `person:${t.id}`, type: 'person_payment', txnIds: [t.id], merchant: t.merchant, cents: Math.abs(t.cents),
      prompt: `What was the $${(Math.abs(t.cents) / 100).toFixed(2)} payment on ${t.date} for? (${t.merchant.replace('Zelle: ', '')})`,
      detail: 'Payments to people carry no receipt, so the category comes from you.',
      choices: catChoices, canApplyToMerchant: true,
    });

  // merchants we could not categorise, and one-off candidates
  const unknown = new Map<string, Txn[]>();
  for (const t of txns.filter((t) => t.category === 'uncategorized' && t.kind === 'spend' && !t.hints?.includes('person_payment')))
    unknown.set(t.merchant, [...(unknown.get(t.merchant) ?? []), t]);
  for (const [m, ts] of unknown) {
    const cents = ts.reduce((s, t) => s - t.cents, 0);
    if (cents < 500 && ts.length < 2) continue;
    push({
      id: `cat:${m}`, type: 'category', txnIds: ts.map((t) => t.id), merchant: m, cents,
      prompt: `What do you buy from ${m}? ${ts.length} charge${ts.length > 1 ? 's' : ''}, $${(cents / 100).toFixed(2)} in total.`,
      detail: 'One answer is applied to every charge from this merchant, now and later.',
      choices: catChoices, canApplyToMerchant: true,
    });
  }

  // business or personal, once per merchant
  const bp = new Map<string, Txn[]>();
  for (const t of txns.filter((t) => t.hints?.includes('business_or_personal') && t.business === undefined)) bp.set(t.merchant, [...(bp.get(t.merchant) ?? []), t]);
  for (const [m, ts] of bp) {
    const cents = ts.reduce((s, t) => s - t.cents, 0);
    push({
      id: `bp:${m}`, type: 'business_or_personal', txnIds: ts.map((t) => t.id), merchant: m, cents,
      prompt: `Is ${m} a personal expense or a business expense? (${ts.length} charge${ts.length > 1 ? 's' : ''}, $${(cents / 100).toFixed(2)})`,
      detail: 'Business items are kept out of household totals and can be reported separately.',
      choices: BP, canApplyToMerchant: true,
    });
  }

  // large single charges: one-off or recurring?
  for (const t of txns.filter((t) => t.hints?.includes('large_one_off') && t.oneOff === undefined))
    push({
      id: `oneoff:${t.id}`, type: 'one_off', txnIds: [t.id], merchant: t.merchant, cents: Math.abs(t.cents),
      prompt: `$${(Math.abs(t.cents) / 100).toFixed(2)} at ${t.merchant} on ${t.date}. Does this repeat, or was it a one-time expense?`,
      detail: 'One-time expenses are shown but left out of next month\'s forecast.',
      choices: [{ value: 'one_off', label: 'One-time' }, { value: 'recurring', label: 'It repeats' }],
      canApplyToMerchant: false,
    });

  // mixed-basket stores: ask for items, ranked by dollars
  const items = new Map<string, Txn[]>();
  for (const t of txns.filter((t) => t.hints?.includes('needs_items') && !t.receiptId)) items.set(t.merchant, [...(items.get(t.merchant) ?? []), t]);
  for (const [m, ts] of items) {
    const cents = ts.reduce((s, t) => s - t.cents, 0);
    if (cents < 2000) continue;
    push({
      id: `items:${m}`, type: 'items', txnIds: ts.map((t) => t.id), merchant: m, cents,
      prompt: `${ts.length} ${m} purchases ($${(cents / 100).toFixed(2)}) have no item detail. Add the receipts to see what was in them.`,
      detail: 'Without a receipt this spending stays in one lump instead of groceries, household and clothing.',
      choices: [{ value: 'upload', label: 'Add receipts' }, { value: 'skip', label: 'Skip for now' }],
      canApplyToMerchant: false,
    });
  }

  return out.sort((a, b) => b.cents - a.cents);
}

// ---------------------------------------------------------------------------
// Cash entry: a short conversation that keeps asking until the record is usable.
// ---------------------------------------------------------------------------
export interface CashDraft {
  amount?: number;      // dollars
  merchant?: string;
  what?: string;
  category?: string;
  date?: string;
  business?: boolean;
  oneOff?: boolean;
  lines?: { item: string; amount: number }[];
  splitAsked?: boolean;
  /** set when the purchase was entered from an uploaded receipt */
  receiptId?: string;
}
export interface CashStep { field: keyof CashDraft; prompt: string; kind: 'money' | 'text' | 'category' | 'date' | 'yesno'; suggestion?: string }

const KEYWORD_CATEGORY: [RegExp, string][] = [
  [/gas|fuel|petrol/i, 'fuel'], [/grocer|vegetable|fruit|meat|milk|egg|rice|bread|halal|kosher/i, 'groceries'],
  [/doctor|clinic|pharm|medicine|dental|lab/i, 'medical'], [/tire|oil change|repair|mechanic|car wash/i, 'auto'],
  [/restaurant|lunch|dinner|coffee|food truck|pizza/i, 'restaurants'], [/haircut|barber|salon/i, 'personal_care'],
  [/school|tuition|daycare|kids|book/i, 'education'], [/donat|charity|church|temple|mosque|tithe|zakat/i, 'giving'],
];
export const suggestCategory = (text: string): string | undefined => KEYWORD_CATEGORY.find(([re]) => re.test(text))?.[1];

/** Returns the next thing to ask, or null when the entry is complete enough to save. */
export function nextCashStep(d: CashDraft): CashStep | null {
  if (d.amount == null || !(d.amount > 0)) return { field: 'amount', kind: 'money', prompt: 'How much cash did you pay?' };
  if (!d.merchant?.trim()) return { field: 'merchant', kind: 'text', prompt: 'Who did you pay? A store, a person, a service.' };
  if (!d.what?.trim()) return { field: 'what', kind: 'text', prompt: `What did you buy from ${d.merchant}? A few words is fine.` };
  if (!d.category) return { field: 'category', kind: 'category', prompt: 'Which category fits best?', suggestion: suggestCategory(`${d.merchant} ${d.what}`) };
  // a bigger or mixed purchase gets an itemisation offer, once
  if (!d.splitAsked && (d.amount >= 50 || /,| and | & /.test(d.what))) return { field: 'lines', kind: 'text', prompt: `That is $${d.amount.toFixed(2)} across more than one thing. List each item with its price (e.g. "tomatoes 4.50, rice 12") or skip to keep it as one line.` };
  if (!d.date) return { field: 'date', kind: 'date', prompt: 'When did you pay? (today if blank)' };
  if (d.business === undefined) return { field: 'business', kind: 'yesno', prompt: 'Was this for a business? (No keeps it in household spending)' };
  if (d.amount >= 100 && d.oneOff === undefined) return { field: 'oneOff', kind: 'yesno', prompt: 'Is this a one-time expense, not something you pay every month?' };
  return null;
}

/** Parse "tomatoes 4.50, rice 12" into line items. Anything unparseable is reported so the app can ask again. */
export function parseLines(input: string, allowNegative = false): { lines: { item: string; amount: number }[]; bad: string[] } {
  const lines: { item: string; amount: number }[] = []; const bad: string[] = [];
  for (const part of input.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean)) {
    // "New price -2.50" is a discount line when negatives are allowed (receipts); "Item - 4.50" is just a dash between the name and the price
    const neg = allowNegative ? part.match(/^(.*\S)\s+-\$?(\d+(?:\.\d{1,2})?)$/) : null;
    if (neg && neg[1].replace(/[\s:]+$/, '')) { lines.push({ item: neg[1].replace(/[\s:]+$/, ''), amount: -Number(neg[2]) }); continue; }
    const m = part.match(/^(.*?)[\s:$-]*\$?(\d+(?:\.\d{1,2})?)$/);
    if (m && m[1].trim()) lines.push({ item: m[1].trim(), amount: Number(m[2]) }); else bad.push(part);
  }
  return { lines, bad };
}
