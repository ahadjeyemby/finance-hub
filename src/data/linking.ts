// Finds and stores links between receipts that are already saved and the charges now in the ledger. Used after every statement import and by
// the Links screen. Only strong matches are stored; a likely one is returned for the person to confirm. The rules are in core/links.ts.
import { learnAliases, linkTrust } from '@/core/learn';
import { planLinks, storedKeys } from '@/core/links';
import type { Plan } from '@/core/links';
import type { Account, Txn } from '@/core/types';
import { fetchLinkData, saveLinks } from './links';

export interface SweepResult {
  /** links stored just now (automatic, not yet confirmed by the person) */
  saved: number;
  /** likely matches left for the person to confirm */
  suggested: number;
  plan: Plan;
}

/** Match stored receipts with charges. Returns null when links are not available (no connection, or migration 0003 not run). */
export async function sweepLinks(txns: Txn[], accounts: Account[], owner?: string): Promise<SweepResult | null> {
  const data = await fetchLinkData(owner);
  if (!data) return null;
  const keys = storedKeys(data);
  const plan = planLinks({ receipts: data.receipts, txns, links: data.links, flags: data.flags, accounts, aliases: learnAliases(keys, txns), trust: linkTrust(keys, txns, accounts) });
  const sure = plan.proposals.filter((p) => p.sure);
  await saveLinks(sure.map((p) => ({ receiptId: p.receiptId, txnId: p.txnId, role: p.role, method: p.method, reason: p.reason, confirmed: false })), owner);
  return { saved: sure.length, suggested: plan.proposals.length - sure.length, plan };
}
