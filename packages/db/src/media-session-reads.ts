import { and, eq, gt, ne } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { actors } from './schema/actors';
import { mediaParticipants } from './schema/media-sessions';
import { roundParticipants } from './schema/round-participants';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';

/**
 * A Round's non-judge seats with the identity each holds in one media
 * session, the one seat read every media worker role (capture, bot
 * listener) admits by.
 */
export const readSessionSeats = (
  tx: BoundedTransactionContext,
  roundId: string,
  sessionId: string,
) =>
  tx
    .select({
      roundParticipantId: roundParticipants.id,
      kind: actors.kind,
      identity: mediaParticipants.identity,
    })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .leftJoin(
      mediaParticipants,
      and(
        eq(mediaParticipants.roundParticipantId, roundParticipants.id),
        eq(mediaParticipants.sessionId, sessionId),
      ),
    )
    .where(
      and(
        eq(roundParticipants.roundId, roundId),
        ne(roundParticipants.role, 'judge'),
      ),
    )
    .orderBy(roundParticipants.id);

/** One page of a segment's speaking grants, after `afterIntervalId` when given. */
export async function readSpeakingIntervals(
  tx: BoundedTransactionContext,
  roundId: string,
  segmentId: string,
  afterIntervalId?: string,
) {
  const rows = await tx
    .select()
    .from(roundSpeakingIntervals)
    .where(
      and(
        eq(roundSpeakingIntervals.roundId, roundId),
        eq(roundSpeakingIntervals.segmentId, segmentId),
        ...(afterIntervalId
          ? [gt(roundSpeakingIntervals.id, afterIntervalId)]
          : []),
      ),
    )
    .orderBy(roundSpeakingIntervals.id)
    .limit(513);
  const page = rows.slice(0, 512);
  return {
    intervals: page.map((row) => ({
      id: row.id,
      roundParticipantId: row.roundParticipantId,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      startedVersion: row.startedVersion,
      endedVersion: row.endedVersion,
    })),
    nextIntervalId: rows.length > 512 ? page.at(-1)!.id : null,
  };
}
