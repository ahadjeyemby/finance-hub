// Whose rows a query is about. Since workspaces (migration 0006) an admin's database role can also read and write their members' rows, so a query that
// says nothing about the owner would quietly mix people's data, or change someone else's row that happens to share an id. Every query in the app
// therefore names its owner: the signed-in person by default, and a member only where the person is deliberately working on that member's data.

let current: string | null = null;

/** Called once the signed-in person is known (and with null on sign-out). */
export const setCurrentUser = (id: string | null) => { current = id; };

/**
 * Whose row an account is, and what its id is in the database. A member's accounts are shown to their admin with a prefixed id and their owner's id
 * (see core/team.ts); the database knows them by the plain id, under the member's user id.
 */
export function dbAccount(a: { id: string; owner?: string }): { owner: string; id: string } {
  const me = meId();
  if (a.owner && a.owner !== me) return { owner: a.owner, id: a.id.startsWith(`${a.owner}:`) ? a.id.slice(a.owner.length + 1) : a.id };
  return { owner: me, id: a.id };
}

let contributingTo: string | null = null;

/**
 * Set when the signed-in person is a Contributor (migration 0009): the owner whose books they add to. A Contributor reads and writes nothing
 * directly; every data call checks this and goes through the contributor functions instead.
 */
export const setContributingTo = (owner: string | null) => { contributingTo = owner; };
export const contributorOwner = (): string | null => contributingTo;

/** The signed-in person's id. Throws when nobody is signed in, so a query never runs unscoped. */
export const meId = (): string => {
  if (!current) throw new Error('Signed out. Sign in again.');
  return current;
};
