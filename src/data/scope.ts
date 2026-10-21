// Whose rows a query is about. Since workspaces (migration 0006) an admin's database role can also read and write their members' rows, so a query that
// says nothing about the owner would quietly mix people's data, or change someone else's row that happens to share an id. Every query in the app
// therefore names its owner: the signed-in person by default, and a member only where the person is deliberately working on that member's data.

let current: string | null = null;

/** Called once the signed-in person is known (and with null on sign-out). */
export const setCurrentUser = (id: string | null) => { current = id; };

/** The signed-in person's id. Throws when nobody is signed in, so a query never runs unscoped. */
export const meId = (): string => {
  if (!current) throw new Error('Signed out. Sign in again.');
  return current;
};
