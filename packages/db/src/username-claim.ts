import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { users } from './schema/users';

export type UsernameClaim = {
  readonly kind:
    'claimed' | 'unchanged' | 'taken' | 'already-set' | 'unknown-user';
};

/**
 * PostgreSQL unique_violation (SQLSTATE 23505). Bun SQL reports it as
 * `errno` (its `code` is `ERR_POSTGRES_SERVER_ERROR`) inside drizzle's
 * wrapper, so every layer of the cause chain is checked.
 */
const isUniqueViolation = (error: unknown): boolean => {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    depth += 1, current = (current as { cause?: unknown }).cause
  )
    if (
      (current as { errno?: unknown }).errno === '23505' ||
      (current as { code?: unknown }).code === '23505'
    )
      return true;
  return false;
};

/**
 * Server-owned onboarding: sets the username of a user that has none, in one
 * statement. Uniqueness is the case-insensitive unique index, so concurrent
 * claims of one name produce exactly one winner and every loser changes
 * nothing. A retry by the owner reports `unchanged`.
 */
export async function claimUsername(
  database: BunSQLDatabase,
  input: { readonly userId: string; readonly username: string },
  reportFailure: (operation: string) => void,
): Promise<UsernameClaim> {
  try {
    const claimed = await database
      .update(users)
      .set({
        username: input.username,
        updatedAt: sql`now()`,
        version: sql`${users.version} + 1`,
      })
      .where(and(eq(users.id, input.userId), isNull(users.username)))
      .returning({ id: users.id });
    if (claimed.length > 0) return { kind: 'claimed' };
    const [current] = await database
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!current) return { kind: 'unknown-user' };
    return current.username?.toLowerCase() === input.username.toLowerCase()
      ? { kind: 'unchanged' }
      : { kind: 'already-set' };
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'taken' };
    reportFailure('claimUsername');
    throw error;
  }
}
