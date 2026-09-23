import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { eq } from 'drizzle-orm';
import { actors } from './schema/actors';

export type ActorRecord = {
  readonly id: string;
  readonly userId: string | null;
};

/**
 * The one query both `apps/web`'s public lookup and RT-2.2's in-transaction
 * revocation resolution run (ACTOR-1): resolving `actors.id` from
 * `actors.user_id`. Selects only `(id, user_id)` so the query shape matches
 * the realtime role's column-scoped grant (`GRANT SELECT (id, user_id) ON
 * actors`, ADR 0032 / RT-2.2) — never `kind` or the audit timestamps. Takes
 * `Pick<..., 'select'>` so a caller inside `database.transaction` can pass
 * its `tx` and share one connection with whatever it does next.
 */
export const queryActorByUserId = async (
  db: Pick<BunSQLDatabase, 'select'>,
  userId: string,
): Promise<ActorRecord | null> => {
  const [row] = await db
    .select({ id: actors.id, userId: actors.userId })
    .from(actors)
    .where(eq(actors.userId, userId))
    .limit(1);
  return row ?? null;
};

export const actorOperations = ({
  database,
  reportFailure,
}: {
  database: BunSQLDatabase;
  reportFailure: (operation: string) => void;
}) => ({
  async getActorByUserId(userId: string): Promise<ActorRecord | null> {
    try {
      return await queryActorByUserId(database, userId);
    } catch (error) {
      reportFailure('getActorByUserId');
      throw error;
    }
  },
});
