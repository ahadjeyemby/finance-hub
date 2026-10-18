import type { Category, CategoryId } from './types';

export const CATEGORIES: Category[] = [
  { id: 'groceries', label: 'Groceries', group: 'need' },
  { id: 'household', label: 'Household & supplies', group: 'need' },
  { id: 'clothing', label: 'Clothing & shoes', group: 'mixed' },
  { id: 'fuel', label: 'Fuel', group: 'need' },
  { id: 'medical', label: 'Medical', group: 'need' },
  { id: 'auto', label: 'Car maintenance & registration', group: 'need' },
  { id: 'insurance', label: 'Insurance', group: 'need' },
  { id: 'phone', label: 'Phone & utilities', group: 'need' },
  { id: 'education', label: 'Education & kids', group: 'need' },
  { id: 'personal_care', label: 'Personal care', group: 'need' },
  { id: 'government', label: 'Government & fees', group: 'need' },
  { id: 'restaurants', label: 'Restaurants', group: 'want' },
  { id: 'entertainment', label: 'Entertainment', group: 'want' },
  { id: 'travel', label: 'Travel', group: 'want' },
  { id: 'subscriptions', label: 'Software & subscriptions', group: 'mixed' },
  { id: 'electronics', label: 'Electronics & gear', group: 'want' },
  { id: 'online_shopping', label: 'Online shopping (unsplit)', group: 'mixed' },
  { id: 'mixed_retail', label: 'Big-box stores (unsplit)', group: 'mixed' },
  { id: 'giving', label: 'Giving', group: 'mixed' },
  { id: 'people', label: 'Payments to people', group: 'mixed' },
  { id: 'other', label: 'Other', group: 'mixed' },
  { id: 'uncategorized', label: 'Needs a category', group: 'mixed' },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export const categoryLabel = (id?: CategoryId | string): string => (id && BY_ID.get(id as CategoryId)?.label) || 'Needs a category';
export const categoryGroup = (id?: CategoryId): Category['group'] => (id && BY_ID.get(id)?.group) || 'mixed';
export const isCategoryId = (s: string): s is CategoryId => BY_ID.has(s as CategoryId);
