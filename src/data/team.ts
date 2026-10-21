import type { PersonData } from '@/core/team';
import { emptyOverlay } from '@/core/types';
import { fetchLinkData } from './links';
import { fetchLedger, fetchOverlay } from './sync';

/**
 * What the admin may read of each member's data: their accounts, charges, decisions and receipt links. The database only returns it while the
 * membership is active; a member who is paused or gone simply comes back empty. One member failing to load never hides the others.
 */
export async function fetchTeamData(memberIds: string[]): Promise<PersonData[]> {
  const out: PersonData[] = [];
  for (const id of memberIds) {
    try {
      const [ledger, overlay, links] = await Promise.all([fetchLedger(id), fetchOverlay(id), fetchLinkData(id)]);
      out.push({ id, accounts: ledger?.accounts ?? [], txns: ledger?.txns ?? [], overlay: overlay ?? emptyOverlay(), links });
    } catch { /* this member could not be read: leave them out rather than show half of them */ }
  }
  return out;
}
