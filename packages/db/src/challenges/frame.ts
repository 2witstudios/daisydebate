import { and, eq, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, createRefusal } from '@daisy/errors';
import { divisionAgeBand, divisionOfBandSql } from '../ladder-division-band';
import {
  buildUserInboxTopic,
  lobbyOf,
  idSchema,
  type RatingDivision,
  type RatingStyle,
  type CompetitionType,
} from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import type { ContactPairKey } from '../contacts/reactions';
import type { ContactInput } from '../contacts/fence';
import { oweNotifications } from '../notifications/owe';
import { appendOutboxEvent } from '../outbox';
import { rowsOf } from '../raw-rows';
import { readAvailability } from '../presence/availability';
import { openRoomHostedBy } from '../room-open';
import { challenges } from '../schema/challenges';
import { rooms, roomSeatHolds } from '../schema/rooms';

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
    /** Mints the challenged member's notification ids (ADR 0144). */
    readonly nextId: () => string;
    readonly mode: CompetitionType;
    readonly format: RatingStyle;
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
    /** Mints the challenger's notification ids (ADR 0144). */
    readonly nextId: () => string;
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
 * The lobby both members share (ADR 0156), or null when they are in
 * different lobbies; a ranked offer also needs both to hold a division (an
 * age record), as a ranked debater seat does.
 */
async function pairLobby(
  tx: Tx,
  challenger: string,
  challenged: string,
  mode: 'ranked' | 'casual',
): Promise<RatingDivision | null> {
  const rows = await rowsOf<{ division: RatingDivision | null }>(
    tx,
    sql`select ${divisionOfBandSql(divisionAgeBand())} as division
      from actors member left join account_age on account_age.user_id = member.user_id
      where member.id in (${challenger}, ${challenged})`,
  );
  const [first, second] = rows;
  if (rows.length !== 2 || !first || !second) return null;
  if (
    mode === 'ranked' &&
    (first.division === null || second.division === null)
  )
    return null;
  const lobby = lobbyOf(first);
  return lobby === lobbyOf(second) ? lobby : null;
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
    async send({ id, nextId, mode, format, now, expiresAt }) {
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
      // A challenge stays inside one lobby (ADR 0156): both members',
      // read under the pair's lock.
      const division = await pairLobby(tx, input.actorId, other, mode);
      if (division === null) throw createRefusal('CONFLICT', 'other-division');
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
          division,
          createdAt: new Date(now),
          expiresAt: new Date(expiresAt),
        })
        .onConflictDoNothing()
        .returning({ id: challenges.id });
      if (inserted[0]) {
        await ring(owner, [input.actorId, other]);
        const recipients = await rowsOf<{ user_id: string }>(
          tx,
          sql`select user_id from actors where id=${other} and user_id is not null`,
        );
        await oweNotifications(tx, {
          kind: 'challenge_received',
          subject: { challenge_id: inserted[0].id },
          recipients: recipients.map((row) => ({
            userId: row.user_id,
            about: input.actorId,
          })),
          at: now,
          nextId,
        });
        return { challengeId: inserted[0].id };
      }
      // A second offer while one stands replaces its terms, so "sent" is true.
      const [open] = await tx
        .update(challenges)
        .set({
          mode,
          formatId: format,
          division,
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
    async accept({ challengeId, roomId, now, followUntil, nextId }) {
      await authorize();
      requireId(roomId);
      requireId(challengeId);
      // Only a room made for this offer: its format and mode, holding a seat
      // for the challenger, so no other room the acceptor hosts can receive
      // them. Visibility is the room's own fact (public by default, and always
      // when ranked); the hold, not visibility, names the challenge's room.
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
            openRoomHostedBy(roomId, input.actorId),
          ),
        )
        .innerJoin(
          roomSeatHolds,
          and(
            eq(roomSeatHolds.roomId, rooms.id),
            eq(roomSeatHolds.actorId, other),
            sql`${roomSeatHolds.until} > ${new Date(now)}`,
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
      // The challenger is waited for now: urgent, never emailed (ADR 0144).
      const recipients = await rowsOf<{ user_id: string }>(
        tx,
        sql`select user_id from actors where id=${other} and user_id is not null`,
      );
      await oweNotifications(tx, {
        kind: 'challenge_accepted',
        subject: { challenge_id: challengeId },
        recipients: recipients.map((row) => ({
          userId: row.user_id,
          about: input.actorId,
        })),
        at: now,
        nextId,
      });
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
