import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type {
  CaptureTx,
  CaptureIdentity,
  CaptureStream,
  CoverageTolerance,
} from './media-capture-context';
import type { CaptureInterval } from './capture-coverage';
import { actors } from './schema/actors';
import { roundBotPublicationWindows } from './schema/round-bot-publications';
import { roundParticipants } from './schema/round-participants';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import { roundTranscripts } from './schema/transcript-segments';
import type { roundSegments } from './schema/round-segments';

type Segment = typeof roundSegments.$inferSelect;
export async function captureHistory(
  tx: CaptureTx,
  input: CaptureIdentity & CaptureStream,
  segment: Segment,
) {
  const rows = await tx
    .select()
    .from(roundSpeakingIntervals)
    .where(
      and(
        eq(roundSpeakingIntervals.roundId, input.roundId),
        eq(roundSpeakingIntervals.segmentId, input.segmentId),
        eq(roundSpeakingIntervals.roundParticipantId, input.roundParticipantId),
      ),
    );
  const segmentStart = segment.startedAt.getTime();
  const segmentEnd = Math.min(
    segment.endedAt?.getTime() ?? Infinity,
    segmentStart + segment.durationMs,
  );
  const required = rows.map((row) => ({
    start: Math.max(row.startedAt.getTime(), segmentStart),
    end:
      row.endedAt === null ? null : Math.min(row.endedAt.getTime(), segmentEnd),
  }));
  if (!required.some((row) => row.end === null || row.end > row.start))
    throw createAppError('CONFLICT', 'No historical capture authority');
  return required;
}
/**
 * What a seat's stream must cover for a 'complete' seal and how far its edges
 * may move (DEC-218, DEC-220): a human's speaking grants, joined within the
 * join tolerance; a bot's credited publication windows, joined within relay
 * latency. Silence outside a bot's windows is not speech.
 */
export async function coverageAuthority(
  tx: CaptureTx,
  input: CaptureIdentity & CaptureStream,
  grants: readonly CaptureInterval[],
  tolerance: CoverageTolerance,
) {
  const [seat] = await tx
    .select({ kind: actors.kind })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .where(
      and(
        eq(roundParticipants.id, input.roundParticipantId),
        eq(roundParticipants.roundId, input.roundId),
      ),
    );
  if (seat?.kind !== 'bot')
    return {
      authority: grants,
      tolerance: { openMs: tolerance.joinMs, closeMs: tolerance.relayMs },
    };
  const windows = await tx
    .select({
      start: roundBotPublicationWindows.creditedFrom,
      end: roundBotPublicationWindows.creditedUntil,
    })
    .from(roundBotPublicationWindows)
    .where(
      and(
        eq(roundBotPublicationWindows.segmentId, input.segmentId),
        eq(roundBotPublicationWindows.roundId, input.roundId),
        eq(
          roundBotPublicationWindows.roundParticipantId,
          input.roundParticipantId,
        ),
      ),
    );
  return {
    authority: windows.map((row) => ({
      start: row.start.getTime(),
      end: row.end.getTime(),
    })),
    tolerance: { openMs: tolerance.relayMs, closeMs: tolerance.relayMs },
  };
}
export const transcriptRevision = async (tx: CaptureTx, roundId: string) => {
  const [row] = await tx
    .select({ revision: roundTranscripts.revision })
    .from(roundTranscripts)
    .where(eq(roundTranscripts.roundId, roundId));
  return row?.revision ?? 0;
};
export async function advanceTranscriptRevision(
  tx: CaptureTx,
  roundId: string,
) {
  const [row] = await tx
    .insert(roundTranscripts)
    .values({ roundId, revision: 1 })
    .onConflictDoUpdate({
      target: roundTranscripts.roundId,
      set: { revision: sql`${roundTranscripts.revision}+1` },
    })
    .returning({ revision: roundTranscripts.revision });
  if (!row) throw createAppError('INFRASTRUCTURE');
  return row.revision;
}
