import type { CashDraft } from './questions';
import type { Overlay, Question, Txn } from './types';

/** Result of answering an inbox question: the new overlay plus an optional follow-up for the UI. */
export interface AnswerResult { overlay: Overlay; goto?: 'add' }

const merge = (o: Overlay, patch: Partial<Overlay>): Overlay => ({ ...o, ...patch });

/**
 * Turn one inbox answer into overlay edits. Pure: the same inputs always give the same overlay,
 * and the seed ledger is never modified.
 */
export function applyAnswer(q: Question, choice: string, toMerchant: boolean, overlay: Overlay): AnswerResult {
  const patches = { ...overlay.patches };
  const rules = { ...overlay.merchantRules };
  const patchAll = (p: Overlay['patches'][string]) => { for (const id of q.txnIds) patches[id] = { ...patches[id], ...p }; };
  let answered = true;
  let goto: AnswerResult['goto'];

  switch (q.type) {
    case 'confirm_income':
      if (choice === 'salary' || choice === 'other') patchAll({ kind: 'income', subtype: choice });
      else if (choice === 'reimbursement') patchAll({ kind: 'transfer', subtype: 'reimbursement' });
      else patchAll({ kind: 'transfer', subtype: 'own_confirmed' });
      break;
    case 'transfer_account':
      if (choice === 'own') patchAll({ subtype: 'own_confirmed' });
      else patchAll({ kind: 'spend', subtype: undefined, category: 'other' });
      break;
    case 'person_payment':
    case 'category':
      if (toMerchant && q.canApplyToMerchant) rules[q.merchant] = { ...rules[q.merchant], category: choice as Txn['category'] };
      patchAll({ category: choice as Txn['category'] });
      break;
    case 'business_or_personal':
      if (toMerchant && q.canApplyToMerchant) rules[q.merchant] = { ...rules[q.merchant], business: choice === 'business' };
      patchAll({ business: choice === 'business' });
      break;
    case 'one_off':
      patchAll({ oneOff: choice === 'one_off' });
      break;
    case 'items':
      if (choice === 'upload') { answered = false; goto = 'add'; }
      break;
  }
  const next = merge(overlay, { patches, merchantRules: rules, answered: answered ? { ...overlay.answered, [q.id]: choice } : overlay.answered });
  return { overlay: next, goto };
}

/** Undo an answer: removes the patches it wrote. Used by the Undo toast in the inbox. */
export function undoAnswer(q: Question, overlay: Overlay): Overlay {
  const patches = { ...overlay.patches };
  const rules = { ...overlay.merchantRules };
  for (const id of q.txnIds) delete patches[id];
  if (q.canApplyToMerchant) delete rules[q.merchant];
  const answered = { ...overlay.answered };
  delete answered[q.id];
  return { ...overlay, patches, merchantRules: rules, answered };
}

/** Build the ledger row for a finished cash conversation. Item lines always add up to the total. */
export function cashToTxn(d: CashDraft, today: string, now = Date.now()): Txn {
  const cents = Math.round((d.amount ?? 0) * 100);
  const date = d.date || today;
  let lines = (d.lines ?? []).map((l) => ({ item: l.item, cents: Math.round(l.amount * 100) }));
  const sum = lines.reduce((s, l) => s + l.cents, 0);
  if (lines.length && sum < cents) lines = [...lines, { item: 'Other (not itemised)', cents: cents - sum }];
  if (lines.length && sum > cents) lines = [];
  return {
    id: `cash:${now}`, accountId: 'cash', date, description: d.what ?? '', merchant: d.merchant?.trim() || 'Cash',
    cents: -cents, kind: 'spend', category: (d.category as Txn['category']) ?? 'uncategorized',
    business: d.business, oneOff: d.oneOff, manual: true, source: d.receiptId ? 'Cash entry from a receipt' : 'Cash entry', note: d.what,
    lines: lines.length ? lines : undefined, receiptId: d.receiptId, createdAt: new Date(now).toISOString(),
  };
}
