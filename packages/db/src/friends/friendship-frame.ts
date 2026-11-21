import { and, count, eq, ne, or } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { contactPairs } from '../schema/contacts';
import { friendships, friendGuardianApprovals } from '../schema/friends';
import type { ContactInput } from '../contacts/fence';
import type { FriendFrame } from './contracts';
import {
  clearSocialDeclines,
  recordSocialDecline,
  spendSocialRequest,
} from '../contacts/request-budget';
import type { ContactReactions } from '../contacts/reactions';
import type { lockAuthorizationActors } from '../authorization';
import { guardianHoldsForRequest } from './guardian-approval-facts';
import { holdForGuardian } from './hold-for-guardian';
import { tellFriend } from './request-notice';

type FriendshipTransaction = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

const accepted = (actorId: string) =>
  and(
    eq(friendships.state, 'accepted'),
    or(
      eq(friendships.lowActorId, actorId),
      eq(friendships.highActorId, actorId),
    ),
  );

async function countWhere(
  tx: FriendshipTransaction,
  where: ReturnType<typeof and>,
) {
  const [row] = await tx
    .select({ value: count() })
    .from(friendships)
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
  input: ContactInput,
  rows: readonly (typeof contactPairs.$inferSelect)[],
  authorize: () => Promise<void>,
  relations: ContactReactions['relations'],
  accounts: Readonly<Awaited<ReturnType<typeof lockAuthorizationActors>>>,
): Pick<FriendFrame, 'readFriendship' | 'commitFriendship'> {
  const pairOf = () => {
    if (rows.length !== 1) throw createAppError('VALIDATION');
    return rows[0]!;
  };
  const where = (pair: typeof contactPairs.$inferSelect) =>
    and(
      eq(friendships.lowActorId, pair.lowActorId),
      eq(friendships.highActorId, pair.highActorId),
    );
  return {
    async readFriendship() {
      const pair = pairOf();
      const otherActorId =
        pair.lowActorId === input.actorId ? pair.highActorId : pair.lowActorId;
      const [current] = await tx
        .select({
          state: friendships.state,
          requesterActorId: friendships.requesterActorId,
        })
        .from(friendships)
        .where(where(pair))
        .for('update');
      const guardianHolds =
        current?.state === 'accepted'
          ? []
          : await guardianHoldsForRequest(
              tx,
              pair,
              accounts,
              current?.requesterActorId ?? input.actorId,
            );
      return {
        otherActorId,
        pair: current ?? null,
        ...(guardianHolds.length ? { guardianHolds } : {}),
        actorPendingOutgoing: await countWhere(
          tx,
          and(
            ne(friendships.state, 'accepted'),
            eq(friendships.requesterActorId, input.actorId),
          ),
        ),
        actorFriends: await countWhere(tx, accepted(input.actorId)),
        otherFriends: await countWhere(tx, accepted(otherActorId)),
      };
    },
    async commitFriendship({
      previous,
      next,
      requestId,
      now,
      limits,
      nextId,
      guardianHolds = [],
    }) {
      await authorize();
      const pair = pairOf();
      const otherActorId =
        pair.lowActorId === input.actorId ? pair.highActorId : pair.lowActorId;
      const tell = (
        kind: 'friend_request_received' | 'friend_request_accepted',
        recipientActorId: string,
      ) =>
        tellFriend(tx, {
          kind,
          pair,
          recipientActorId,
          about: input.actorId,
          at: now,
          nextId,
        });
      if (!next) {
        await tx.delete(friendships).where(where(pair));
        // Ending someone else's pending request is a decline (DEC-251).
        if (
          previous &&
          previous.state !== 'accepted' &&
          previous.requesterActorId !== input.actorId
        )
          await recordSocialDecline(tx, {
            declinerActorId: input.actorId,
            requesterActorId: previous.requesterActorId,
            now,
            limits,
          });
        return;
      }
      if (next.state === 'accepted')
        await clearSocialDeclines(tx, input.actorId, otherActorId);
      if (!previous) {
        if (next.state !== 'accepted')
          await (
            await spendSocialRequest(
              tx,
              {
                actorId: input.actorId,
                counterpartActorId: otherActorId,
                kind: 'friend',
                requestId,
                now,
                limits,
              },
              relations,
            )
          )();
        await tx.insert(friendships).values({
          lowActorId: pair.lowActorId,
          highActorId: pair.highActorId,
          requesterActorId: next.requesterActorId,
          state: next.state,
          requestedAt: new Date(now),
          acceptedAt: next.state === 'accepted' ? new Date(now) : null,
        });
      } else {
        await tx
          .update(friendships)
          .set({
            state: next.state,
            requesterActorId: next.requesterActorId,
            acceptedAt: next.state === 'accepted' ? new Date(now) : null,
          })
          .where(where(pair));
      }
      if (
        next.state === 'pending' &&
        (!previous || previous.state === 'waiting-for-guardian')
      )
        await tell('friend_request_received', otherActorId);
      if (next.state === 'waiting-for-guardian')
        for (const childActorId of guardianHolds)
          await holdForGuardian(tx, { pair, childActorId, at: now, nextId });
      if (next.state === 'accepted')
        await tx
          .delete(friendGuardianApprovals)
          .where(
            and(
              eq(friendGuardianApprovals.lowActorId, pair.lowActorId),
              eq(friendGuardianApprovals.highActorId, pair.highActorId),
            ),
          );
      // Answering someone else's request tells them it was accepted.
      if (
        previous &&
        previous.state !== 'accepted' &&
        next.state === 'accepted' &&
        previous.requesterActorId !== input.actorId
      )
        await tell('friend_request_accepted', previous.requesterActorId);
    },
  };
}
