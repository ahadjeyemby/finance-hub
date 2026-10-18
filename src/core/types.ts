// Core domain types. Pure TypeScript: no React, no Expo, no Node APIs.
// Sign convention: `cents` is from the account holder's point of view.
//   negative = money left the account, positive = money came in.

export type Kind =
  | 'spend'     // a purchase or bill: counts as spending
  | 'fee'       // bank/interest fee: counts as spending
  | 'refund'    // merchant credit: reduces spending
  | 'income'    // money earned (salary, deposits you confirm as income)
  | 'rewards'   // cash back / points redeemed: tracked apart from income
  | 'transfer'; // card payments, moves between your own accounts: never spend, never income

export type AccountType = 'checking' | 'credit' | 'cash';

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  last4: string;
  /** First and last day (inclusive, ISO) for which we hold complete statements. */
  coverage: { from: string; to: string };
  /** false = we cannot yet claim every deposit for this person is visible (other accounts exist). */
  incomeComplete?: boolean;
}

export interface Txn {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  description: string; // raw bank description
  merchant: string; // cleaned name
  cents: number;
  kind: Kind;
  /** transfer: 'card_payment' | 'internal'; income: 'salary' | 'other' | 'unconfirmed' */
  subtype?: string;
  category?: CategoryId;
  subcategory?: string;
  /** true when the business-tagged part should be excluded from personal totals */
  business?: boolean;
  /** user marked as one-off so forecasts ignore it */
  oneOff?: boolean;
  /** id of the matching leg of a transfer on another account */
  pairId?: string;
  /** statement or file this row came from, for audit trail */
  source: string;
  /** Amazon order number etc. so receipts can be attached later */
  ref?: string;
  note?: string;
  /** machine hints that drive the question inbox */
  hints?: Hint[];
  /** set when the user typed it in (cash) */
  manual?: boolean;
  /** receipt document attached to this transaction (a row in the receipts table) */
  receiptId?: string;
  /** manual entries: when the person entered it, ISO UTC with time */
  createdAt?: string;
  /** manual entries: when it first reached the database. Stays empty until a push succeeds. */
  uploadedAt?: string;
  /** item lines when the transaction was split from a receipt or typed in */
  lines?: { item: string; cents: number; category?: CategoryId }[];
}

export type Hint =
  | 'needs_items'          // mixed-basket store: split by item once a receipt arrives
  | 'unknown_merchant'
  | 'person_payment'
  | 'confirm_income'
  | 'confirm_transfer_account'
  | 'business_or_personal'
  | 'large_one_off';

export type CategoryId =
  | 'groceries' | 'household' | 'clothing' | 'fuel' | 'restaurants' | 'medical'
  | 'auto' | 'insurance' | 'phone' | 'subscriptions' | 'travel' | 'education'
  | 'giving' | 'personal_care' | 'online_shopping' | 'mixed_retail' | 'electronics'
  | 'entertainment' | 'government' | 'people' | 'other' | 'uncategorized';

export interface Category {
  id: CategoryId;
  label: string;
  group: 'need' | 'want' | 'mixed';
}

export interface Question {
  id: string;
  type: 'category' | 'confirm_income' | 'person_payment' | 'business_or_personal' | 'transfer_account' | 'one_off' | 'items';
  txnIds: string[];
  merchant: string;
  prompt: string;
  detail: string;
  /** dollars at stake so the inbox can sort by what matters */
  cents: number;
  choices: { value: string; label: string }[];
  /** answering can create a rule for every future transaction from this merchant */
  canApplyToMerchant: boolean;
}

/** User edits layered over the immutable seed or the database rows. */
export interface Overlay {
  /** manual transactions (cash etc.) */
  manual: Txn[];
  /** per transaction patch */
  patches: Record<string, Partial<Pick<Txn, 'category' | 'kind' | 'subtype' | 'business' | 'oneOff' | 'note' | 'merchant' | 'lines' | 'receiptId'>>>;
  /** merchant -> patch, applied to every transaction from that merchant */
  merchantRules: Record<string, Partial<Pick<Txn, 'category' | 'business'>>>;
  answered: Record<string, string>;
  savedReports: SavedReport[];
}

export interface SavedReport {
  id: string;
  createdAt: string;
  prompt: string;
  spec: import('./report').ReportSpec;
}

export const emptyOverlay = (): Overlay => ({ manual: [], patches: {}, merchantRules: {}, answered: {}, savedReports: [] });
