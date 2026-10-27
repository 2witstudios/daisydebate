import { and, count, eq, or } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  messagingContactPairs,
  messagingFriendships,
} from '../schema/messaging-social';
import type {
  MessagingSocialFrame,
  MessagingSocialInput,
} from './social-contracts';

type FriendshipTransaction = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete'
>;

const accepted = (actorId: string) =>
  and(
    eq(messagingFriendships.state, 'accepted'),
    or(
      eq(messagingFriendships.lowActorId, actorId),
      eq(messagingFriendships.highActorId, actorId),
    ),
  );

async function countWhere(
  tx: FriendshipTransaction,
  where: ReturnType<typeof and>,
) {
  const [row] = await tx
    .select({ value: count() })
    .from(messagingFriendships)
    .where(where);
  return row?.value ?? 0;
}

/**
 * Friendship reads and writes inside the contact frame: the account rows and
 * the pair row are already locked, so the pair and both members' counts are
 * current until commit. Every write reauthorizes first (ADR 0072).
 */
export function friendshipFrame(
  tx: FriendshipTransaction,
  input: MessagingSocialInput,
  rows: readonly (typeof messagingContactPairs.$inferSelect)[],
  authorize: () => Promise<void>,
): Pick<MessagingSocialFrame, 'readFriendship' | 'commitFriendship'> {
  const pairOf = () => {
    if (rows.length !== 1) throw createAppError('VALIDATION');
    return rows[0]!;
  };
  const where = (pair: typeof messagingContactPairs.$inferSelect) =>
    and(
      eq(messagingFriendships.lowActorId, pair.lowActorId),
      eq(messagingFriendships.highActorId, pair.highActorId),
    );
  return {
    async readFriendship() {
      const pair = pairOf();
      const otherActorId =
        pair.lowActorId === input.actorId ? pair.highActorId : pair.lowActorId;
      const [current] = await tx
        .select({
          state: messagingFriendships.state,
          requesterActorId: messagingFriendships.requesterActorId,
        })
        .from(messagingFriendships)
        .where(where(pair))
        .for('update');
      return {
        otherActorId,
        pair: current
          ? {
              state: current.state as 'pending' | 'accepted',
              requesterActorId: current.requesterActorId,
            }
          : null,
        actorPendingOutgoing: await countWhere(
          tx,
          and(
            eq(messagingFriendships.state, 'pending'),
            eq(messagingFriendships.requesterActorId, input.actorId),
          ),
        ),
        actorFriends: await countWhere(tx, accepted(input.actorId)),
        otherFriends: await countWhere(tx, accepted(otherActorId)),
      };
    },
    async commitFriendship({ previous, next, now }) {
      await authorize();
      const pair = pairOf();
      if (!next) {
        await tx.delete(messagingFriendships).where(where(pair));
        return;
      }
      if (!previous) {
        await tx.insert(messagingFriendships).values({
          lowActorId: pair.lowActorId,
          highActorId: pair.highActorId,
          requesterActorId: next.requesterActorId,
          state: next.state,
          requestedAt: new Date(now),
          acceptedAt: next.state === 'accepted' ? new Date(now) : null,
        });
        return;
      }
      await tx
        .update(messagingFriendships)
        .set({
          state: next.state,
          requesterActorId: next.requesterActorId,
          acceptedAt: next.state === 'accepted' ? new Date(now) : null,
        })
        .where(where(pair));
    },
  };
}
