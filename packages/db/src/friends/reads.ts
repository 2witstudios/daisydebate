import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { contactPairs } from '../schema/contacts';
import { friendships } from '../schema/friends';
import { presenceSettings } from '../schema/presence';
import { readOwnCollection, type OwnCollectionFence } from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';

export type FriendshipRow = {
  readonly otherActorId: string;
  readonly username: string;
  readonly state: 'pending' | 'accepted';
  readonly requesterActorId: string;
  readonly requestedAt: string;
  /** Whether the counterpart hides their online status from friends. */
  readonly otherHidden: boolean;
};

/** The bound on one member's listed pairs: friends, then pending requests. */
const FRIENDSHIP_LIST_MAX = 500;

type FriendshipListScope = {
  readonly userId: string;
  readonly actorId: string;
};

/** Refuses a scope that is not two well-formed ids before any query. */
const requireScope = (scope: FriendshipListScope) => {
  if (
    !idSchema.safeParse(scope.userId).success ||
    !idSchema.safeParse(scope.actorId).success
  )
    throw createAppError('VALIDATION');
};

/**
 * One member's own friendships and requests with each counterpart's current
 * username, after `authorize` passes on the reader's locked account. Erased,
 * unnamed and blocked counterparts drop out. A read only: every change
 * reloads the pair under the contact fence (ADR 0072).
 */
export async function listFriendships(
  database: BunSQLDatabase,
  scope: FriendshipListScope,
  authorize: OwnCollectionFence<FriendshipListScope>,
): Promise<readonly FriendshipRow[]> {
  requireScope(scope);
  return readOwnCollection(database, scope, authorize, (tx) =>
    readRows(tx, scope.actorId),
  );
}

export type FriendChallengeRow = {
  readonly roomId: string;
  readonly username: string;
  readonly title: string;
  readonly challengedAt: string;
};

/**
 * The challenges waiting for one member (ADR 0072): from accepted, unblocked
 * friends, for rooms that still assemble, after `authorize` passes on the
 * reader's locked account. Newest first, bounded like the list.
 */
export async function listFriendChallenges(
  database: BunSQLDatabase,
  scope: FriendshipListScope,
  authorize: OwnCollectionFence<FriendshipListScope>,
): Promise<readonly FriendChallengeRow[]> {
  if (
    !idSchema.safeParse(scope.userId).success ||
    !idSchema.safeParse(scope.actorId).success
  )
    throw createAppError('VALIDATION');
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const rows = (await tx.execute(sql`
      select c.room_id as "roomId", u.username, r.title,
        c.created_at as "challengedAt"
      from friend_challenges c
      join rooms r on r.id = c.room_id and r.status in ('assembling', 'ready')
      join friendships f
        on f.low_actor_id = least(c.challenger_actor_id, c.challenged_actor_id)
        and f.high_actor_id = greatest(c.challenger_actor_id, c.challenged_actor_id)
        and f.state = 'accepted'
      join contact_pairs p
        on p.low_actor_id = f.low_actor_id and p.high_actor_id = f.high_actor_id
        and not p.low_blocks_high and not p.high_blocks_low
      join actors a on a.id = c.challenger_actor_id
      join users u on u.id = a.user_id
        and u.deleted_at is null and u.username is not null
      where c.challenged_actor_id = ${scope.actorId}
      order by c.created_at desc
      limit ${FRIENDSHIP_LIST_MAX}`)) as unknown as {
      roomId: string;
      username: string;
      title: string;
      challengedAt: Date | string;
    }[];
    return rows.map((row) => ({
      roomId: row.roomId,
      username: row.username,
      title: row.title,
      challengedAt: new Date(row.challengedAt).toISOString(),
    }));
  });
}

/** The database's friendship reads, instrumented like its other operations. */
export const friendshipReadOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** One member's own friendships and requests (ADR 0072). */
  listFriendships: (
    scope: FriendshipListScope,
    authorize: OwnCollectionFence<FriendshipListScope>,
  ) =>
    instrumented(eventSink, 'listFriendships', () =>
      listFriendships(database, scope, authorize),
    ),
  /** The challenges waiting for one member (ADR 0072). */
  listFriendChallenges: (
    scope: FriendshipListScope,
    authorize: OwnCollectionFence<FriendshipListScope>,
  ) =>
    instrumented(eventSink, 'listFriendChallenges', () =>
      listFriendChallenges(database, scope, authorize),
    ),
});

async function readRows(
  tx: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
): Promise<readonly FriendshipRow[]> {
  const other = sql<string>`case when ${friendships.lowActorId} = ${actorId} then ${friendships.highActorId} else ${friendships.lowActorId} end`;
  const rows = await tx
    .select({
      otherActorId: other,
      username: users.username,
      otherHidden: sql<boolean>`coalesce(${presenceSettings.hidden}, false)`,
      state: friendships.state,
      requesterActorId: friendships.requesterActorId,
      requestedAt: friendships.requestedAt,
    })
    .from(friendships)
    .innerJoin(
      contactPairs,
      and(
        eq(contactPairs.lowActorId, friendships.lowActorId),
        eq(contactPairs.highActorId, friendships.highActorId),
      ),
    )
    .innerJoin(actors, eq(actors.id, other))
    .leftJoin(presenceSettings, eq(presenceSettings.actorId, other))
    .innerJoin(users, eq(users.id, actors.userId))
    .where(
      and(
        or(
          eq(friendships.lowActorId, actorId),
          eq(friendships.highActorId, actorId),
        ),
        eq(contactPairs.lowBlocksHigh, false),
        eq(contactPairs.highBlocksLow, false),
        isNull(users.deletedAt),
        isNotNull(users.username),
      ),
    )
    .orderBy(asc(friendships.state), desc(friendships.requestedAt))
    .limit(FRIENDSHIP_LIST_MAX);
  return rows.map((row) => ({
    otherActorId: row.otherActorId,
    username: row.username!,
    state: row.state as 'pending' | 'accepted',
    requesterActorId: row.requesterActorId,
    requestedAt: row.requestedAt.toISOString(),
    otherHidden: row.otherHidden === true,
  }));
}
