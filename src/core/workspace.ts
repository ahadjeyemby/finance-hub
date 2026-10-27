// Workspaces from the app's side: who the signed-in person is (an admin, a member, a contributor, or working alone), who their members are, and
// the small amount of logic around invites. Pure TypeScript. The rules themselves live in the database (migration 0006); this file only describes
// what the database says. Kept in step with supabase/functions/_shared/access.ts.

export type Role = 'admin' | 'solo' | 'member' | 'contributor';
export interface Access { role: Role; owner: string | null; can_read_ai: boolean; active: boolean }
export interface Member { member: string; role: 'member' | 'contributor'; can_read_ai: boolean; active: boolean; email: string | null; label: string | null; created_at: string }
export interface Invite { id: string; email: string; role: 'member' | 'contributor'; can_read_ai: boolean; expires_at: string; accepted_at: string | null; created_at: string }

export const ROLE_LABEL: Record<Member['role'], string> = { member: 'Member', contributor: 'Contributor' };
export const ROLE_HELP: Record<Member['role'], string> = {
  member: 'The full app on their own data.',
  contributor: 'Adds receipts and credit card statements to your books, and sees only your spending.',
};

/** how a member is shown: the label the admin chose, else the address, else a short id */
export const memberName = (m: Pick<Member, 'label' | 'email' | 'member'>): string => m.label?.trim() || m.email || `Member ${m.member.slice(0, 6)}`;

/** a person who belongs to someone else's workspace */
export const isMemberRole = (a: Access | null): boolean => a?.role === 'member' || a?.role === 'contributor';
/** a person who can invite and manage others */
export const canManage = (a: Access | null): boolean => !!a && (a.role === 'admin' || a.role === 'solo');
/** an admin sees more than their own data: they have at least one active member */
export const hasTeam = (members: Member[]): boolean => members.some((m) => m.active);

/** The invite code from whatever the person pastes: the whole link from the email, or just the code. null if there is none. */
export function extractToken(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const q = /[?&#]token=([A-Za-z0-9]+)/.exec(text);
  if (q) return q[1];
  return /^[A-Za-z0-9]{32,128}$/.test(text) ? text : null;
}

/** Invites still waiting: not accepted and not expired. */
export const pendingInvites = (invites: Invite[], now: Date = new Date()): Invite[] => invites.filter((i) => !i.accepted_at && Date.parse(i.expires_at) > now.getTime());

/** A sentence for the admin about what a member can expect, shown at invite time. The trust point matters most for a spouse. */
export function visibilityNotice(role: Member['role'], canReadAi: boolean): string {
  const what = role === 'contributor'
    ? 'They add receipts and credit card statements to your books, and see your spending, refunds and fees. Deposits, pay, transfers, rewards, balances, your checking statements and your income settings never reach them, and nothing they see mentions them.'
    : 'They use the app on their own data.';
  return `${what} You will be able to see, add, change and delete everything they add. They are told this. ${canReadAi ? 'They may use the AI readers on your credit.' : 'They cannot use the AI readers.'}`;
}

/**
 * What a member reads about their own place in the workspace. A Contributor's wording speaks only of spending: it says nothing about what is
 * kept from them, so it does not tell them that anything else is recorded.
 */
export function memberNotice(role: Role): string {
  return role === 'contributor'
    ? 'You help keep track of the spending in someone else\'s workspace: add receipts and credit card statements, and sort the spending you see.'
    : 'You belong to someone else\'s workspace. You see only what you add.';
}

/** A Contributor sees the spending of someone else's books (migration 0010). */
export const isContributor = (a: Access | null): boolean => a?.role === 'contributor';
