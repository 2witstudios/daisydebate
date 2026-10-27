import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import {
  messagingContactPairs,
  messagingFriendships,
  messagingPresenceSettings,
} from '../schema/messaging-social';
import { readOwnCollection, type OwnCollectionFence } from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';

export type MessagingFriendshipRow = {
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

/**
 * One member's own friendships and requests with each counterpart's current
 * username, after `authorize` passes on the reader's locked account. Erased,
 * unnamed and blocked counterparts drop out. A read only: every change
 * reloads the pair under the contact fence (ADR 0072).
 */
export async function listMessagingFriendships(
  database: BunSQLDatabase,
  scope: FriendshipListScope,
  authorize: OwnCollectionFence<FriendshipListScope>,
): Promise<readonly MessagingFriendshipRow[]> {
  if (
    !idSchema.safeParse(scope.userId).success ||
    !idSchema.safeParse(scope.actorId).success
  )
    throw createAppError('VALIDATION');
  return readOwnCollection(database, scope, authorize, (tx) =>
    readRows(tx, scope.actorId),
  );
}

/** Whether the member hides their online status; no row means visible. */
export function readPresenceHidden(
  database: BunSQLDatabase,
  scope: FriendshipListScope,
  authorize: OwnCollectionFence<FriendshipListScope>,
): Promise<boolean> {
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const [row] = await tx
      .select({ hidden: messagingPresenceSettings.hidden })
      .from(messagingPresenceSettings)
      .where(eq(messagingPresenceSettings.actorId, scope.actorId));
    return row?.hidden ?? false;
  });
}

/** Sets the member's own choice, after `authorize` on their locked account. */
export function writePresenceHidden(
  database: BunSQLDatabase,
  scope: FriendshipListScope,
  input: { readonly hidden: boolean; readonly now: string },
  authorize: OwnCollectionFence<FriendshipListScope>,
): Promise<boolean> {
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const values = { hidden: input.hidden, updatedAt: new Date(input.now) };
    await tx
      .insert(messagingPresenceSettings)
      .values({ actorId: scope.actorId, ...values })
      .onConflictDoUpdate({
        target: messagingPresenceSettings.actorId,
        set: values,
      });
    return input.hidden;
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
  listMessagingFriendships: (
    scope: FriendshipListScope,
    authorize: OwnCollectionFence<FriendshipListScope>,
  ) =>
    instrumented(eventSink, 'listMessagingFriendships', () =>
      listMessagingFriendships(database, scope, authorize),
    ),
  /** The member's own presence visibility (ADR 0072). */
  readPresenceHidden: (
    scope: FriendshipListScope,
    authorize: OwnCollectionFence<FriendshipListScope>,
  ) =>
    instrumented(eventSink, 'readPresenceHidden', () =>
      readPresenceHidden(database, scope, authorize),
    ),
  writePresenceHidden: (
    scope: FriendshipListScope,
    input: { readonly hidden: boolean; readonly now: string },
    authorize: OwnCollectionFence<FriendshipListScope>,
  ) =>
    instrumented(eventSink, 'writePresenceHidden', () =>
      writePresenceHidden(database, scope, input, authorize),
    ),
});

async function readRows(
  tx: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
): Promise<readonly MessagingFriendshipRow[]> {
  const other = sql<string>`case when ${messagingFriendships.lowActorId} = ${actorId} then ${messagingFriendships.highActorId} else ${messagingFriendships.lowActorId} end`;
  const rows = await tx
    .select({
      otherActorId: other,
      username: users.username,
      otherHidden: sql<boolean>`coalesce(${messagingPresenceSettings.hidden}, false)`,
      state: messagingFriendships.state,
      requesterActorId: messagingFriendships.requesterActorId,
      requestedAt: messagingFriendships.requestedAt,
    })
    .from(messagingFriendships)
    .innerJoin(
      messagingContactPairs,
      and(
        eq(messagingContactPairs.lowActorId, messagingFriendships.lowActorId),
        eq(messagingContactPairs.highActorId, messagingFriendships.highActorId),
      ),
    )
    .innerJoin(actors, eq(actors.id, other))
    .leftJoin(
      messagingPresenceSettings,
      eq(messagingPresenceSettings.actorId, other),
    )
    .innerJoin(users, eq(users.id, actors.userId))
    .where(
      and(
        or(
          eq(messagingFriendships.lowActorId, actorId),
          eq(messagingFriendships.highActorId, actorId),
        ),
        eq(messagingContactPairs.lowBlocksHigh, false),
        eq(messagingContactPairs.highBlocksLow, false),
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
    otherHidden: row.otherHidden === true,
  }));
}
