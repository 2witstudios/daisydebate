import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema, parseUsername } from '@daisy/protocol';
import { actors } from './schema/actors';
import { users } from './schema/users';
import { instrumented, type DatabaseEventSink } from './instrumented';

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
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Public intent discovery only; all contact authority is reloaded under locks. */
  async lookupHumanActorByUsername(input: unknown): Promise<string | null> {
    const parsed = parseUsername(input);
    if (!parsed.ok) throw createAppError('VALIDATION');
    return instrumented(eventSink, 'lookupHumanActorByUsername', async () => {
      const [row] = await database
        .select({ actorId: actors.id })
        .from(actors)
        .innerJoin(users, eq(users.id, actors.userId))
        .where(
          and(
            eq(sql`lower(${users.username})`, parsed.username),
            eq(actors.kind, 'human'),
            eq(users.emailVerified, true),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      const actor = idSchema.safeParse(row?.actorId);
      return actor.success ? actor.data : null;
    });
  },
  async getActorByUserId(userId: string): Promise<ActorRecord | null> {
    return instrumented(eventSink, 'getActorByUserId', () =>
      queryActorByUserId(database, userId),
    );
  },
});
