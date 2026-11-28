import { createId } from '@paralleldrive/cuid2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { RoundProjection } from '@daisy/protocol/runtime';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import type { Tx } from './tx';

/** Called after command/segment insertion in the same transaction; replay never calls it. */
export async function writeSpeakingProjection(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly projection: RoundProjection;
    readonly resultingVersion: number;
    readonly commandId: string | null;
  },
) {
  for (const change of input.projection.speakingChanges ?? []) {
    if (change.kind === 'close') {
      // A close never ends an interval before it began. A platform pause
      // rewinds the speech to its last confirmed audio, which can fall before a
      // later speakers change (an accepted point, its end, a leave): what was
      // granted after that instant was never confirmed, so it closes with no
      // length rather than an inverted span (round_speaking_intervals_time_check).
      await tx
        .update(roundSpeakingIntervals)
        .set({
          endedAt: sql`greatest(${change.at}::timestamptz, ${roundSpeakingIntervals.startedAt})`,
          endedVersion: input.resultingVersion,
          endedCommandId: input.commandId,
        })
        .where(
          and(
            eq(roundSpeakingIntervals.roundId, input.roundId),
            eq(roundSpeakingIntervals.segmentId, change.segmentId),
            isNull(roundSpeakingIntervals.endedAt),
          ),
        );
    } else {
      for (const participantId of change.participantIds)
        await tx.insert(roundSpeakingIntervals).values({
          id: createId(),
          roundId: input.roundId,
          segmentId: change.segmentId,
          roundParticipantId: participantId,
          startedAt: new Date(change.at),
          startedVersion: input.resultingVersion,
          startedCommandId: input.commandId,
        });
    }
  }
}
