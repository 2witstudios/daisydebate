import { and, eq, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { friendChallenges } from '../schema/friends';
import { type contactPairs } from '../schema/contacts';
import type { ContactInput } from '../contacts/fence';
import type { FriendFrame } from './contracts';
import { openRoomHostedBy, roomIsOpen } from '../room-open';

type ContactPair = Pick<
  typeof contactPairs.$inferSelect,
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
      eq(friendChallenges.challengerActorId, challenger),
      eq(friendChallenges.challengedActorId, challenged),
    );
  await tx
    .delete(friendChallenges)
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
  input: ContactInput,
  rows: readonly (typeof contactPairs.$inferSelect)[],
  authorize: () => Promise<void>,
): Pick<FriendFrame, 'commitChallenge' | 'declineChallenge'> {
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
        delete from friend_challenges c using rooms
        where rooms.id = c.room_id and not (${roomIsOpen()})
          and ((c.challenger_actor_id = ${input.actorId} and c.challenged_actor_id = ${otherOf()})
            or (c.challenger_actor_id = ${otherOf()} and c.challenged_actor_id = ${input.actorId}))`);
      const recorded = await tx.execute(sql`
        insert into friend_challenges
          (room_id, challenger_actor_id, challenged_actor_id, created_at)
        select rooms.id, ${input.actorId}, ${otherOf()}, ${new Date(now)}
        from rooms
        where ${openRoomHostedBy(roomId, input.actorId)}
        on conflict (room_id) do nothing
        returning room_id`);
      if (recorded.length === 1) return { recorded: true };
      // A room already challenging this same friend is recorded (a repeat
      // Challenge); one challenging someone else is not (ISSUE-700).
      const same = await tx.execute(sql`
        select 1 from friend_challenges c join rooms on rooms.id = c.room_id
        where c.challenger_actor_id = ${input.actorId}
          and c.challenged_actor_id = ${otherOf()}
          and ${openRoomHostedBy(roomId, input.actorId)}`);
      return { recorded: same.length === 1 };
    },
    async declineChallenge({ roomId }) {
      await authorize();
      requireRoom(roomId);
      await tx.execute(sql`
        delete from friend_challenges
        where room_id = ${roomId} and challenged_actor_id = ${input.actorId}
          and challenger_actor_id = ${otherOf()}`);
    },
  };
}
