import type { Access, Invite, Member } from '@/core/workspace';
import { callFunction, supabase } from './supabase';

// The database enforces every rule (migration 0006). These calls only ask it questions and make requests; whatever it refuses comes back as an error
// with a message meant for the person.

const need = () => { if (!supabase) throw new Error('No backend is configured.'); return supabase; };
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

/** What the signed-in person is, or null when the backend does not have workspaces yet (migration 0006 not run) or is not configured. */
export async function myAccess(): Promise<Access | null> {
  if (!supabase) return null;
  const r = await supabase.rpc('my_access');
  if (r.error) return null;
  return r.data as Access;
}

export async function listMembers(): Promise<Member[]> {
  const r = await need().from('members').select('member, role, can_read_ai, active, email, label, created_at').order('created_at');
  fail(r.error);
  return (r.data ?? []) as Member[];
}

export async function listInvites(): Promise<Invite[]> {
  const r = await need().from('invites').select('id, email, role, can_read_ai, expires_at, accepted_at, created_at').order('created_at', { ascending: false });
  fail(r.error);
  return (r.data ?? []) as Invite[];
}

export interface InviteResult { token: string; link: string | null; emailed: boolean; note: string }
/** Create an invite and, when the backend knows its web address, email it. Only an admin (or someone working alone) may. */
export const inviteMember = (email: string, role: 'member' | 'contributor', canReadAi: boolean): Promise<InviteResult> =>
  callFunction<InviteResult>('invite-member', { email, role, can_read_ai: canReadAi });

/** Join a workspace with an invite code. Works only when signed in with the address the invite was sent to. */
export async function acceptInvite(token: string): Promise<{ workspace_owner: string; role: string; can_read_ai: boolean }> {
  const r = await need().rpc('accept_invite', { p_token: token });
  fail(r.error);
  return r.data as { workspace_owner: string; role: string; can_read_ai: boolean };
}

export async function updateMember(member: string, patch: Partial<Pick<Member, 'label' | 'role' | 'can_read_ai' | 'active'>>): Promise<void> {
  const r = await need().from('members').update(patch).eq('member', member).select('member');
  fail(r.error);
  if (!r.data?.length) throw new Error('That change was not allowed.');
}

/** End a membership: the admin removing someone, or a member leaving. Nobody's data is deleted. */
export async function endMembership(member: string): Promise<void> {
  const r = await need().from('members').delete().eq('member', member).select('member');
  fail(r.error);
}

export async function revokeInvite(id: string): Promise<void> { fail((await need().from('invites').delete().eq('id', id)).error); }

/** Set a password: needed after signing in from an invite email, which creates the account without one. */
export async function setPassword(password: string): Promise<void> { fail((await need().auth.updateUser({ password })).error); }
