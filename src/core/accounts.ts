// Account numbers. One account can have several: a reissued card, a changed account number, a debit or credit card that belongs to a checking
// account. The main number is Account.last4; the others are Account.extraNumbers. Anything that asks "is this number that account's?" uses
// these helpers so a second number is never forgotten in one place. Pure TypeScript.
import type { Account, AccountNumber, AccountNumberKind } from './types';

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
