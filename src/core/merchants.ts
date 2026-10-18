import type { CategoryId, Hint } from './types';
import localRules from '../data/seed/merchant-rules.json';

export interface MerchantRule {
  re: RegExp;
  merchant: string;
  category: CategoryId;
  subcategory?: string;
  hints?: Hint[];
  /** Filed as business spending without asking. Dev tools only for now. */
  business?: boolean;
}

/** Shape of one entry in src/data/seed/merchant-rules.json (your own, never committed). `re` is a regex source. */
export interface LocalRule {
  re: string;
  merchant: string;
  category: CategoryId;
  subcategory?: string;
  hints?: Hint[];
  business?: boolean;
}

/**
 * Rules that ship with the project: national brands and common services only.
 * Order matters: first match wins. Patterns run against the lower-cased bank description.
 * Local shops, schools, clinics and anything else personal belongs in merchant-rules.json.
 */
export const GENERIC_RULES: MerchantRule[] = [
  // fuel
  { re: /costco gas/, merchant: 'Costco Gas', category: 'fuel' },
  { re: /shell oil/, merchant: 'Shell', category: 'fuel' },
  { re: /quiktrip|\bqt \d/, merchant: 'QuikTrip', category: 'fuel' },
  { re: /racetrac/, merchant: 'RaceTrac', category: 'fuel' },
  { re: /\bbp#|^bp\b/, merchant: 'BP', category: 'fuel' },
  { re: /exxon|chevron|mobil\b|speedway/, merchant: 'Gas station', category: 'fuel' },
  // groceries
  { re: /kroger/, merchant: 'Kroger', category: 'groceries' },
  { re: /\baldi\b/, merchant: 'Aldi', category: 'groceries' },
  { re: /trader joe|whole foods|publix|safeway/, merchant: 'Grocery store', category: 'groceries' },
  // big-box stores whose baskets mix categories: split by item when a receipt arrives
  { re: /wal-?mart|wm supercenter|walmart\.com/, merchant: 'Walmart', category: 'mixed_retail', hints: ['needs_items'] },
  { re: /sams ?club/, merchant: "Sam's Club", category: 'mixed_retail', hints: ['needs_items'] },
  { re: /costco(?! gas)/, merchant: 'Costco', category: 'mixed_retail', hints: ['needs_items'] },
  { re: /\btarget\b/, merchant: 'Target', category: 'mixed_retail', hints: ['needs_items'] },
  // clothing and general household
  { re: /ross stores/, merchant: 'Ross', category: 'clothing', hints: ['needs_items'] },
  { re: /burlington/, merchant: 'Burlington', category: 'clothing', hints: ['needs_items'] },
  { re: /marshalls/, merchant: 'Marshalls', category: 'clothing', hints: ['needs_items'] },
  { re: /t\.?j\.? ?maxx/, merchant: 'TJ Maxx', category: 'clothing', hints: ['needs_items'] },
  { re: /dollar tree/, merchant: 'Dollar Tree', category: 'household', hints: ['needs_items'] },
  { re: /five below/, merchant: 'Five Below', category: 'household', hints: ['needs_items'] },
  { re: /big lots/, merchant: 'Big Lots', category: 'household', hints: ['needs_items'] },
  { re: /lowe'?s/, merchant: "Lowe's", category: 'household' },
  { re: /home depot/, merchant: 'Home Depot', category: 'household' },
  // amazon
  { re: /amazon prime\*|amazon prime pmts/, merchant: 'Amazon Prime', category: 'subscriptions' },
  { re: /amazon|amzn/, merchant: 'Amazon', category: 'online_shopping', hints: ['needs_items'] },
  // software and subscriptions (developer tools are filed as business; other tools still ask)
  { re: /anthropic|claude/, merchant: 'Claude', category: 'subscriptions', business: true },
  { re: /github/, merchant: 'GitHub', category: 'subscriptions', business: true },
  { re: /namecheap/, merchant: 'Namecheap', category: 'subscriptions', business: true },
  { re: /heroku/, merchant: 'Heroku', category: 'subscriptions', business: true },
  { re: /openrouter/, merchant: 'OpenRouter', category: 'subscriptions', business: true },
  { re: /upwork/, merchant: 'Upwork', category: 'subscriptions', business: true },
  { re: /linkedin/, merchant: 'LinkedIn', category: 'subscriptions', hints: ['business_or_personal'] },
  { re: /netflix/, merchant: 'Netflix', category: 'subscriptions' },
  { re: /spotify/, merchant: 'Spotify', category: 'subscriptions' },
  { re: /apple\.com\/bill|apple services/, merchant: 'Apple Services', category: 'subscriptions' },
  { re: /apple\.com\/us/, merchant: 'Apple', category: 'electronics', hints: ['unknown_merchant'] },
  // bills
  { re: /t-?mobile|tmobile/, merchant: 'T-Mobile', category: 'phone' },
  { re: /comcast|xfinity|spectrum|verizon|at&t/, merchant: 'Internet & phone', category: 'phone' },
  { re: /state farm/, merchant: 'State Farm', category: 'insurance' },
  { re: /geico|progressive ins/, merchant: 'Insurance', category: 'insurance' },
  // medical
  { re: /laboratory corporation|labcorp/, merchant: 'Labcorp', category: 'medical' },
  { re: /\bcvs\b|walgreens/, merchant: 'Pharmacy', category: 'medical' },
  // travel
  { re: /hertz/, merchant: 'Hertz', category: 'travel' },
  { re: /courtyard by marriott/, merchant: 'Courtyard by Marriott', category: 'travel' },
  // restaurants, misc
  { re: /starbucks|chipotle|mcdonald|krispy kreme|chick-fil-a|panera/, merchant: 'Restaurant', category: 'restaurants' },
  { re: /fedex office/, merchant: 'FedEx Office', category: 'other', subcategory: 'printing & shipping' },
  // things we cannot classify with confidence
  { re: /pypl payin4/, merchant: 'PayPal Pay in 4', category: 'uncategorized', hints: ['unknown_merchant'] },
];

const compile = (rules: LocalRule[]): MerchantRule[] => rules.map((r) => ({ ...r, re: new RegExp(r.re) }));

/** Your own rules run first, so they can override a generic one. */
export const MERCHANT_RULES: MerchantRule[] = [...compile(localRules as LocalRule[]), ...GENERIC_RULES];

/** Swap the personal rules. The sample build uses [] so the public sample never depends on anyone's private file. */
export function setLocalRules(rules: LocalRule[]): void {
  MERCHANT_RULES.splice(0, MERCHANT_RULES.length, ...compile(rules), ...GENERIC_RULES);
}

export function matchMerchant(description: string): MerchantRule | undefined {
  const d = description.toLowerCase();
  return MERCHANT_RULES.find((r) => r.re.test(d));
}

/** Apple Card ships its own coarse category; used only when no rule matches. */
export const APPLE_CATEGORY_MAP: Record<string, CategoryId> = {
  Grocery: 'groceries',
  Gas: 'fuel',
  Medical: 'medical',
  Insurance: 'insurance',
  Restaurants: 'restaurants',
};

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\s+/g, ' ').trim();
}
