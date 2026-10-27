// Account numbers. One account can have several: a reissued card, a changed account number, a debit or credit card that belongs to a checking
// account. The main number is Account.last4; the others are Account.extraNumbers. Anything that asks "is this number that account's?" uses
// these helpers so a second number is never forgotten in one place. Pure TypeScript.
import type { Account, AccountNumber, AccountNumberKind, Txn } from './types';

export const NUMBER_KIND_LABEL: Record<AccountNumberKind, string> = {
  account: 'Account number', credit_card: 'Credit card', debit_card: 'Debit card', replaced: 'Old or replaced number', other: 'Other',
};
export const NUMBER_KINDS = Object.keys(NUMBER_KIND_LABEL) as AccountNumberKind[];

/** Every number that belongs to the account, main first, once each. */
export const accountNumbers = (a: Pick<Account, 'last4' | 'extraNumbers'>): string[] => [...new Set([a.last4, ...(a.extraNumbers ?? []).map((n) => n.last4)].filter(Boolean))];
export const hasNumber = (a: Pick<Account, 'last4' | 'extraNumbers'>, last4?: string | null): boolean => !!last4 && accountNumbers(a).includes(last4);

/** "1234", "•••• 1234", "acct 0001234" -> the last four digits, or null when there are not four. */
export function parseLast4(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** The account with one more number. Adding a number it already has (as main or extra) changes nothing. */
export function withNumber(a: Account, last4: string, kind: AccountNumberKind = 'other', note?: string): Account {
  if (hasNumber(a, last4)) return a;
  return { ...a, extraNumbers: [...(a.extraNumbers ?? []), { last4, kind, ...(note ? { note } : {}) }] };
}
export const withoutNumber = (a: Account, last4: string): Account => {
  const rest = (a.extraNumbers ?? []).filter((n) => n.last4 !== last4);
  const { extraNumbers: _drop, ...base } = a;
  return rest.length ? { ...base, extraNumbers: rest } : base;
};
/** The list of accounts with one number added to one of them: how a statement with a new number is read as an existing account before anything is saved. */
export const accountsWithNumber = (accounts: Account[], accountId: string, last4: string, kind: AccountNumberKind = 'replaced'): Account[] =>
  accounts.map((a) => (a.id === accountId ? withNumber(a, last4, kind) : a));

export const numberLabel = (n: AccountNumber) => `${n.last4} (${NUMBER_KIND_LABEL[n.kind].toLowerCase()})`;

// ---------------------------------------------------------------------------
// Merging two accounts that are really one
// ---------------------------------------------------------------------------

/** Why these two cannot be merged, or null when they can: the one that is merged away goes into the one that is kept. */
export function whyNotMerge(source: Account, target: Account): string | null {
  if (source.id === target.id) return 'Choose two different accounts.';
  if (source.type === 'cash' || target.type === 'cash') return 'The cash account cannot be merged.';
  if (source.type !== target.type) return `A ${source.type} account cannot be merged into a ${target.type} account.`;
  return null;
}

/** The kept account's numbers after the merge: its own, then the merged-away account's main number (as an old number) and its extras, each once. */
export function mergedNumbers(target: Account, source: Account): AccountNumber[] {
  const have = new Set(accountNumbers(target));
  const out = [...(target.extraNumbers ?? [])];
  for (const n of [{ last4: source.last4, kind: 'replaced' as const }, ...(source.extraNumbers ?? [])]) {
    if (n.last4 && !have.has(n.last4)) { have.add(n.last4); out.push(n); }
  }
  return out;
}

/** The kept account's extra numbers with the ones a merge added taken away again (an undo). */
export function unmergedNumbers(target: Account, source: Account): AccountNumber[] {
  const added = new Set(accountNumbers(source));
  return (target.extraNumbers ?? []).filter((n) => !added.has(n.last4));
}

/** Coverage of the kept account after the merge: from the earlier start to the later end. */
export const mergedCoverage = (a: Account, b: Account) => ({ from: a.coverage.from < b.coverage.from ? a.coverage.from : b.coverage.from, to: a.coverage.to > b.coverage.to ? a.coverage.to : b.coverage.to });

/**
 * Card payments with no matching other leg. On a card (card side) the money came from an account the app cannot see: that is the
 * "paid from an account Finora can't see" figure. On checking (bank side) the card's own statement for that period is probably missing. The
 * two mean different things and are never added together.
 */
export function unmatchedCardPayments(txns: Txn[], accounts: Account[]): { cardSide: Txn[]; bankSide: Txn[]; cardTotal: number } {
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const orphan = txns.filter((t) => t.kind === 'transfer' && t.subtype === 'card_payment' && !t.pairId);
  // a card-side payment is money coming in to the card; a reversal (money going back out) is not funding from anywhere
  const cardSide = orphan.filter((t) => type.get(t.accountId) === 'credit' && t.cents > 0);
  const bankSide = orphan.filter((t) => type.get(t.accountId) === 'checking');
  return { cardSide, bankSide, cardTotal: cardSide.reduce((s, t) => s + Math.abs(t.cents), 0) };
}
