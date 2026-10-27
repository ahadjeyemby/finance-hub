// Who may use the backend functions that spend model credit, and who may manage a workspace. Pure TypeScript with no Deno or Node APIs, so it is
// unit tested (tests/access.test.ts). The facts come from the database (my_access(), migration 0006); this file only decides what they allow.

export interface Access { role: 'admin' | 'solo' | 'member' | 'contributor'; owner: string | null; can_read_ai: boolean; active: boolean }
export type Need = 'reader' | 'admin';
export type Decision = { ok: true } | { ok: false; status: number; error: string };

/** ALLOWED_EMAIL may now name several addresses, separated by commas. */
export const allowedEmails = (raw: string | undefined): string[] => (raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/**
 * `access` is what my_access() said about the caller, or null when the workspace migration is not installed yet (the functions then behave as
 * they did before: ALLOWED_EMAIL alone decides).
 *
 *   - Members and contributors are decided by their membership: it must be active, and the readers need can_read_ai. ALLOWED_EMAIL does not
 *     apply to them: the admin invited them. They can never manage a workspace. A Contributor's readings are of documents they hold and add
 *     to the admin's books (migration 0010); what they then see of those books is decided by the database, not here.
 *   - Admins and people working alone are decided by ALLOWED_EMAIL when it is set (a lock on who may own this deployment), and are otherwise allowed.
 */
export function decide(access: Access | null, email: string | undefined, allowedEmail: string | undefined, need: Need): Decision {
  const locked = allowedEmails(allowedEmail);
  const owner = (): Decision => (locked.length && !locked.includes((email ?? '').toLowerCase()) ? { ok: false, status: 403, error: 'not allowed' } : { ok: true });
  if (!access) return owner();
  if (access.role === 'member' || access.role === 'contributor') {
    if (need === 'admin') return { ok: false, status: 403, error: 'Only the person who manages this workspace can do that.' };
    if (!access.active) return { ok: false, status: 403, error: 'Your access to this workspace is paused. Ask the person who manages it.' };
    if (!access.can_read_ai) return { ok: false, status: 403, error: 'Reading documents with the AI reader is switched off for you. Ask the person who manages this workspace to turn it on.' };
    return { ok: true };
  }
  return owner();
}
