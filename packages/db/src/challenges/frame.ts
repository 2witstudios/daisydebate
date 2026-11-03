import { and, eq, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  buildUserInboxTopic,
  idSchema,
  type RatingLadder,
  type CompetitionType,
} from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import type { ContactPairKey } from '../contacts/reactions';
import type { ContactInput } from '../contacts/fence';
import { appendOutboxEvent } from '../outbox';
import { readAvailability } from '../presence/people-list';
import { openRoomHostedBy } from '../room-open';
import { challenges } from '../schema/challenges';
import { rooms } from '../schema/rooms';

type Tx = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/** One challenge command over a locked contact pair (ADR 0103). */
export type ChallengeFrame = {
  readonly otherActorId: string;
  /** Records a new offer; a repeat of the open one answers it unchanged. */
  readonly send: (input: {
    readonly id: string;
    readonly mode: CompetitionType;
    readonly format: RatingLadder;
    readonly now: string;
    readonly expiresAt: string;
  }) => Promise<{ readonly challengeId: string }>;
  /** Names the room the caller just opened for it. */
  readonly accept: (input: {
    readonly challengeId: string;
    readonly roomId: string;
    readonly now: string;
    /** How long the challenger is still sent to the room. */
    readonly followUntil: string;
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

/**
 * Ends a member's open offers, both ways, when a suspension or ban begins, and
 * rings whoever was on the other end: they could never have met.
 */
export async function endMemberOffers(
  tx: Pick<BunSQLDatabase, 'delete'> & AuthorizationTransaction,
  actorId: string,
) {
  const removed = await tx
    .delete(challenges)
    .where(
      and(
        or(
          eq(challenges.challengerActorId, actorId),
          eq(challenges.challengedActorId, actorId),
        ),
        sql`${challenges.roomId} is null`,
      ),
    )
    .returning({
      challenger: challenges.challengerActorId,
      challenged: challenges.challengedActorId,
    });
  await ring(tx, [
    ...new Set(removed.flatMap((r) => [r.challenger, r.challenged])),
  ]);
}

/** Ends every challenge between a pair, either way: a block leaves none. */
async function endPairChallenges(
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

/** What Challenges registers with Contacts: a block leaves no challenge. */
export const challengeContactReactions = {
  onBlock: async (
    tx: Pick<BunSQLDatabase, 'delete'>,
    pair: ContactPairKey,
    blocked: boolean,
  ) => {
    if (blocked) await endPairChallenges(tx, pair);
  },
};

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
      // The caller's own room is theirs to know, and to leave.
      if (mine.placement !== null) throw createAppError('CONFLICT');
      // One answer with a block, no such member and no lease: never which.
      if (theirs.placement !== null || theirs.chosen !== 'online')
        throw createAppError('NOT_FOUND');
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
      // A second offer while one stands replaces its terms, so "sent" is true.
      const [open] = await tx
        .update(challenges)
        .set({
          mode,
          formatId: format,
          expiresAt: new Date(expiresAt),
        })
        .where(
          and(
            eq(challenges.challengerActorId, input.actorId),
            eq(challenges.challengedActorId, other),
            sql`${challenges.roomId} is null`,
          ),
        )
        .returning({ id: challenges.id });
      if (!open) throw createAppError('CONFLICT');
      await ring(owner, [input.actorId, other]);
      return { challengeId: open.id };
    },
    async accept({ challengeId, roomId, now, followUntil }) {
      await authorize();
      requireId(roomId);
      requireId(challengeId);
      // Only a room made for this offer: its format and mode, and public when
      // ranked so a judge can find it, so no other room the acceptor hosts can
      // receive the challenger.
      const [offer] = await tx
        .select({
          id: challenges.id,
        })
        .from(challenges)
        .innerJoin(
          rooms,
          and(
            eq(rooms.formatId, challenges.formatId),
            eq(rooms.competitionType, challenges.mode),
            sql`${rooms.visibility} = case when ${challenges.mode} = 'ranked' then 'public' else 'unlisted' end`,
            openRoomHostedBy(roomId, input.actorId),
          ),
        )
        .where(
          and(
            eq(challenges.id, challengeId),
            eq(challenges.challengerActorId, other),
            eq(challenges.challengedActorId, input.actorId),
            sql`${challenges.roomId} is null`,
            sql`${challenges.expiresAt} > ${new Date(now)}`,
          ),
        );
      if (!offer) throw createAppError('NOT_FOUND');
      // A challenger who took another room since cannot be sent to this one.
      if ((await readAvailability(owner, other)).placement !== null)
        throw createAppError('NOT_FOUND');
      const updated = await tx
        .update(challenges)
        .set({ roomId, followUntil: new Date(followUntil) })
        .where(
          and(
            eq(challenges.id, challengeId),
            sql`${challenges.roomId} is null`,
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
