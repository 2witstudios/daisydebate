import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { contactPairs } from '../schema/contacts';
import { friendships } from '../schema/friends';
import type { ChosenStatus } from '@daisy/protocol';
import { chosenStatusOf } from '../presence/settings';
import type { MemberPlacement } from '@daisy/protocol';
import { placementOf } from '../presence/availability';
import {
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';

export type FriendshipRow = {
  readonly otherActorId: string;
  readonly username: string;
  readonly state: 'pending' | 'accepted';
  readonly requesterActorId: string;
  readonly requestedAt: string;
  /** The status the counterpart chose. */
  readonly otherChosen: ChosenStatus;
  /** Where the counterpart's active Room has them. */
  readonly otherPlacement: MemberPlacement;
};

/** The bound on one member's listed pairs: friends, then pending requests. */
const FRIENDSHIP_LIST_MAX = 500;

type FriendshipListScope = {
  readonly userId: string;
  readonly actorId: string;
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
  requireOwnScope(scope);
  return readOwnCollection(database, scope, authorize, (tx) =>
    readRows(tx, scope.actorId),
  );
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
      otherChosen: chosenStatusOf(other),
      otherPlacement: placementOf(other),
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
    otherChosen: row.otherChosen,
    otherPlacement: row.otherPlacement,
  }));
}
