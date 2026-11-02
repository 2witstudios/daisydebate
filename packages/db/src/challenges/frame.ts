import { and, eq, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  buildUserInboxTopic,
  idSchema,
  type ChallengeFormat,
  type ChallengeMode,
} from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import type { ContactPairKey } from '../contacts/reactions';
import type { ContactInput } from '../contacts/fence';
import { appendOutboxEvent } from '../outbox';
import { readAvailability } from '../presence/roster';
import { openRoomHostedBy } from '../room-open';
import { challenges } from '../schema/challenges';
import { rooms } from '../schema/rooms';

type Tx = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/** One challenge command over a locked contact pair (ADR 0097). */
export type ChallengeFrame = {
  readonly otherActorId: string;
  /** Records a new offer; a repeat of the open one answers it unchanged. */
  readonly send: (input: {
    readonly id: string;
    readonly mode: ChallengeMode;
    readonly format: ChallengeFormat;
    readonly now: string;
    readonly expiresAt: string;
  }) => Promise<{ readonly challengeId: string }>;
  /** Names the room the caller just opened for it. */
  readonly accept: (input: {
    readonly challengeId: string;
    readonly roomId: string;
    readonly now: string;
  }) => Promise<void>;
  /** The challenged member refuses, or the challenger withdraws. */
  readonly remove: (input: {
    readonly challengeId: string;
    readonly role: 'challenger' | 'challenged';
  }) => Promise<void>;
};

/** Both members' inbox doorbells: the bell says only "read your challenges". */
async function ring(tx: AuthorizationTransaction, actors: readonly string[]) {
  for (const actorId of [...actors].sort())
    await appendOutboxEvent(tx, {
      topic: buildUserInboxTopic(actorId),
      kind: 'challenge.changed',
      version: 1,
      payload: { kind: 'challenge.changed' },
    });
}

/** Ends every challenge between a pair, either way: a block leaves none. */
export async function endPairChallenges(
  tx: Pick<BunSQLDatabase, 'delete'>,
  pair: ContactPairKey,
) {
  const between = (challenger: string, challenged: string) =>
    and(
      eq(challenges.challengerActorId, challenger),
      eq(challenges.challengedActorId, challenged),
    );
  await tx
    .delete(challenges)
    .where(
      or(
        between(pair.lowActorId, pair.highActorId),
        between(pair.highActorId, pair.lowActorId),
      ),
    );
}

/**
 * Challenge writes inside the contact frame: accounts and the pair are locked,
 * so no block or decline races past them. Every write reauthorizes first. A
 * challenge may be refused only by availability, read here under that lock.
 */
export function challengeFrame(
  tx: Tx,
  input: ContactInput,
  authorize: () => Promise<void>,
): ChallengeFrame {
  const other = input.memberActorIds.find((id) => id !== input.actorId);
  if (!other) throw createAppError('VALIDATION');
  const owner = tx as unknown as AuthorizationTransaction;
  const requireId = (id: string) => {
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  };
  return {
    otherActorId: other,
    async send({ id, mode, format, now, expiresAt }) {
      await authorize();
      requireId(id);
      const [mine, theirs] = await Promise.all([
        readAvailability(owner, input.actorId),
        readAvailability(owner, other),
      ]);
      // Appearing offline is refused exactly as busy is: never which.
      if (
        mine.placement !== null ||
        theirs.placement !== null ||
        theirs.chosen !== 'online'
      )
        throw createAppError('CONFLICT', 'challenge-unavailable');
      await tx.execute(sql`
        delete from challenges
        where challenger_actor_id = ${input.actorId} and challenged_actor_id = ${other}
          and room_id is null and expires_at <= ${new Date(now)}`);
      const inserted = await tx
        .insert(challenges)
        .values({
          id,
          challengerActorId: input.actorId,
          challengedActorId: other,
          mode,
          formatId: format,
          createdAt: new Date(now),
          expiresAt: new Date(expiresAt),
        })
        .onConflictDoNothing()
        .returning({ id: challenges.id });
      if (inserted[0]) {
        await ring(owner, [input.actorId, other]);
        return { challengeId: inserted[0].id };
      }
      const [open] = await tx
        .select({ id: challenges.id })
        .from(challenges)
        .where(
          and(
            eq(challenges.challengerActorId, input.actorId),
            eq(challenges.challengedActorId, other),
            sql`${challenges.roomId} is null`,
          ),
        );
      if (!open) throw createAppError('CONFLICT');
      return { challengeId: open.id };
    },
    async accept({ challengeId, roomId, now }) {
      await authorize();
      requireId(roomId);
      const [hosted] = await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(openRoomHostedBy(roomId, input.actorId));
      if (!hosted) throw createAppError('NOT_FOUND');
      const updated = await tx
        .update(challenges)
        .set({ roomId })
        .where(
          and(
            eq(challenges.id, challengeId),
            eq(challenges.challengerActorId, other),
            eq(challenges.challengedActorId, input.actorId),
            sql`${challenges.roomId} is null`,
            sql`${challenges.expiresAt} > ${new Date(now)}`,
          ),
        )
        .returning({ id: challenges.id });
      if (!updated[0]) throw createAppError('NOT_FOUND');
      await ring(owner, [input.actorId, other]);
    },
    async remove({ challengeId, role }) {
      await authorize();
      requireId(challengeId);
      const removed = await tx
        .delete(challenges)
        .where(
          and(
            eq(challenges.id, challengeId),
            role === 'challenged'
              ? and(
                  eq(challenges.challengedActorId, input.actorId),
                  eq(challenges.challengerActorId, other),
                )
              : and(
                  eq(challenges.challengerActorId, input.actorId),
                  eq(challenges.challengedActorId, other),
                ),
            sql`${challenges.roomId} is null`,
          ),
        )
        .returning({ id: challenges.id });
      if (removed[0]) await ring(owner, [input.actorId, other]);
    },
  };
}
