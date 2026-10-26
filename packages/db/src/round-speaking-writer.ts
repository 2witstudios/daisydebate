import { createId } from '@paralleldrive/cuid2';
import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RoundProjection } from '@daisy/protocol';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
type Tx = Pick<BunSQLDatabase, 'update' | 'insert'>;

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
      await tx
        .update(roundSpeakingIntervals)
        .set({
          endedAt: new Date(change.at),
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
