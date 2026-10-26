import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { messagingFriendships } from '../schema/messaging-social';

export type MessagingFriendshipRow = {
  readonly otherActorId: string;
  readonly username: string;
  readonly state: 'pending' | 'accepted';
  readonly requesterActorId: string;
  readonly requestedAt: string;
};

/** The bound on one member's listed pairs: friends, then pending requests. */
const FRIENDSHIP_LIST_MAX = 500;

/**
 * One member's own friendships and requests with each counterpart's current
 * username. Erased or unnamed counterparts drop out. A read only: every
 * change reloads the pair under the contact fence (ADR 0072).
 */
export async function listMessagingFriendships(
  database: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
): Promise<readonly MessagingFriendshipRow[]> {
  if (!idSchema.safeParse(actorId).success) throw createAppError('VALIDATION');
  const other = sql<string>`case when ${messagingFriendships.lowActorId} = ${actorId} then ${messagingFriendships.highActorId} else ${messagingFriendships.lowActorId} end`;
  const rows = await database
    .select({
      otherActorId: other,
      username: users.username,
      state: messagingFriendships.state,
      requesterActorId: messagingFriendships.requesterActorId,
      requestedAt: messagingFriendships.requestedAt,
    })
    .from(messagingFriendships)
    .innerJoin(actors, eq(actors.id, other))
    .innerJoin(users, eq(users.id, actors.userId))
    .where(
      and(
        or(
          eq(messagingFriendships.lowActorId, actorId),
          eq(messagingFriendships.highActorId, actorId),
        ),
        isNull(users.deletedAt),
        isNotNull(users.username),
      ),
    )
    .orderBy(
      asc(messagingFriendships.state),
      desc(messagingFriendships.requestedAt),
    )
    .limit(FRIENDSHIP_LIST_MAX);
  return rows.map((row) => ({
    otherActorId: row.otherActorId,
    username: row.username!,
    state: row.state as 'pending' | 'accepted',
    requesterActorId: row.requesterActorId,
    requestedAt: row.requestedAt.toISOString(),
  }));
}
