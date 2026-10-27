import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { messagingContactPairs } from '../schema/messaging-social';
import type {
  MessagingSocialFrame,
  MessagingSocialInput,
} from './social-contracts';

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
      const recorded = await tx.execute(sql`
        insert into messaging_friend_challenges
          (room_id, challenger_actor_id, challenged_actor_id, created_at)
        select r.id, ${input.actorId}, ${otherOf()}, ${new Date(now)}
        from rooms r
        where r.id = ${roomId} and r.host_actor_id = ${input.actorId}
          and r.status in ('assembling', 'ready')
        on conflict (room_id) do nothing
        returning room_id`);
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
