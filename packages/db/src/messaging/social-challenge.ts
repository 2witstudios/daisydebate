import { and, eq, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  messagingFriendChallenges,
  type messagingContactPairs,
} from '../schema/messaging-social';
import type {
  MessagingSocialFrame,
  MessagingSocialInput,
} from './social-contracts';

type ContactPair = Pick<
  typeof messagingContactPairs.$inferSelect,
  'lowActorId' | 'highActorId'
>;

/**
 * Ends every challenge between the pair, either way (ADR 0072). Called under
 * the pair lock whenever the friendship ends, so a pair that becomes friends
 * again never sees an old challenge return.
 */
export async function endPairChallenges(
  tx: Pick<BunSQLDatabase, 'delete'>,
  pair: ContactPair,
) {
  const between = (challenger: string, challenged: string) =>
    and(
      eq(messagingFriendChallenges.challengerActorId, challenger),
      eq(messagingFriendChallenges.challengedActorId, challenged),
    );
  await tx
    .delete(messagingFriendChallenges)
    .where(
      or(
        between(pair.lowActorId, pair.highActorId),
        between(pair.highActorId, pair.lowActorId),
      ),
    );
}

/**
 * Challenge writes inside the contact frame (ADR 0072): the pair is locked,
 * so the caller's friendship check holds until commit. A challenge names a
 * room the challenger hosts while it still assembles; anything else records
 * nothing. Every write reauthorizes first.
 */
export function challengeFrame(
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: MessagingSocialInput,
  rows: readonly (typeof messagingContactPairs.$inferSelect)[],
  authorize: () => Promise<void>,
): Pick<MessagingSocialFrame, 'commitChallenge' | 'declineChallenge'> {
  const otherOf = () => {
    if (rows.length !== 1) throw createAppError('VALIDATION');
    const pair = rows[0]!;
    return pair.lowActorId === input.actorId
      ? pair.highActorId
      : pair.lowActorId;
  };
  const requireRoom = (roomId: string) => {
    if (!idSchema.safeParse(roomId).success) throw createAppError('VALIDATION');
  };
  return {
    async commitChallenge({ roomId, now }) {
      await authorize();
      requireRoom(roomId);
      // The pair's challenges to rooms no longer open are spent; drop them.
      await tx.execute(sql`
        delete from messaging_friend_challenges c using rooms r
        where r.id = c.room_id and r.status not in ('assembling', 'ready')
          and ((c.challenger_actor_id = ${input.actorId} and c.challenged_actor_id = ${otherOf()})
            or (c.challenger_actor_id = ${otherOf()} and c.challenged_actor_id = ${input.actorId}))`);
      const recorded = await tx.execute(sql`
        insert into messaging_friend_challenges
          (room_id, challenger_actor_id, challenged_actor_id, created_at)
        select r.id, ${input.actorId}, ${otherOf()}, ${new Date(now)}
        from rooms r
        where r.id = ${roomId} and r.host_actor_id = ${input.actorId}
          and r.status in ('assembling', 'ready')
        on conflict (room_id) do update set created_at = messaging_friend_challenges.created_at
          where messaging_friend_challenges.challenger_actor_id = excluded.challenger_actor_id
            and messaging_friend_challenges.challenged_actor_id = excluded.challenged_actor_id
        returning room_id`);
      // A room already challenging this same friend is recorded (a repeat
      // Challenge); one challenging someone else is not (ISSUE-700).
      return { recorded: recorded.length === 1 };
    },
    async declineChallenge({ roomId }) {
      await authorize();
      requireRoom(roomId);
      await tx.execute(sql`
        delete from messaging_friend_challenges
        where room_id = ${roomId} and challenged_actor_id = ${input.actorId}
          and challenger_actor_id = ${otherOf()}`);
    },
  };
}
