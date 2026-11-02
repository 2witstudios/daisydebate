import { createAppError } from '@daisy/errors';
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';
import type {
  CaptureTx,
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
type StreamScope = CaptureStream & { readonly roundId: string };
type Reader = Pick<CaptureTx, 'select'>;
/** A stream's speaking windows within its segment, possibly none. */
async function speakingWindows(
  tx: Reader,
  input: StreamScope,
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
  return grantWindows(rows, segment);
}
/** Grants clamped to their segment's speaking time; an open grant stays open. */
export function grantWindows(
  rows: readonly {
    readonly startedAt: Date;
    readonly endedAt: Date | null;
  }[],
  segment: Pick<Segment, 'startedAt' | 'endedAt' | 'durationMs'>,
) {
  const segmentStart = segment.startedAt.getTime();
  const segmentEnd = Math.min(
    segment.endedAt?.getTime() ?? Infinity,
    segmentStart + segment.durationMs,
  );
  return rows.map((row) => ({
    start: Math.max(row.startedAt.getTime(), segmentStart),
    end:
      row.endedAt === null ? null : Math.min(row.endedAt.getTime(), segmentEnd),
  }));
}
export async function captureHistory(
  tx: Reader,
  input: StreamScope,
  segment: Segment,
) {
  const required = await speakingWindows(tx, input, segment);
  if (!required.some((row) => row.end === null || row.end > row.start))
    throw createAppError('CONFLICT', 'No historical capture authority');
  return required;
}
/**
 * True for a bot seat holding a grant it did not use: not its scheduled turn,
 * and no credited publication window. It owes no stream, so nothing of it can
 * be missing. Its scheduled turn stays owed, so a bot that fails to speak never
 * passes as complete. A turn the rules cannot name stays owed. Takes SQL columns or
 * values, so the freeze and the seal decide by this one rule.
 */
export const botGrantUnused = (
  roundId: SQLWrapper | string,
  segmentId: SQLWrapper | string,
  roundParticipantId: SQLWrapper | string,
) => sql`exists(select 1 from round_participants unused_seat
    join actors unused_actor on unused_actor.id=unused_seat.actor_id
    join rounds unused_round on unused_round.id=unused_seat.round_id
    join round_segments unused_segment on unused_segment.round_id=unused_seat.round_id and unused_segment.id=${segmentId}
    where unused_seat.round_id=${roundId} and unused_seat.id=${roundParticipantId} and unused_actor.kind='bot'
      and (
        unused_round.rules_snapshot->'segments'->unused_segment.sequence->>'side'=unused_seat.role
        and (unused_round.rules_snapshot->'segments'->unused_segment.sequence->>'slot')::integer=unused_seat.slot
      ) is false
      and not exists(select 1 from round_bot_publication_windows unused_credit
        where unused_credit.round_id=${roundId} and unused_credit.segment_id=${segmentId}
          and unused_credit.round_participant_id=${roundParticipantId}))`;

/**
 * What a seat's stream must cover for a 'complete' seal and how far its edges
 * may move (DEC-218, DEC-220): a human's speaking grants, joined within the
 * join tolerance; a bot's credited publication windows, joined within relay
 * latency. Silence outside a bot's windows is not speech.
 */
export async function coverageAuthority(
  tx: Reader,
  input: StreamScope,
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
  if (seat?.kind !== 'bot') return coverageRule('human', grants, [], tolerance);
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
  return coverageRule('bot', grants, windows, tolerance);
}
/** The authority and edges for one seat's kind: the decision, with no reads. */
export function coverageRule(
  kind: 'human' | 'bot',
  grants: readonly CaptureInterval[],
  botWindows: readonly { readonly start: Date; readonly end: Date }[],
  tolerance: CoverageTolerance,
) {
  if (kind !== 'bot')
    return {
      authority: grants,
      tolerance: { openMs: tolerance.joinMs, closeMs: tolerance.relayMs },
    };
  return {
    authority: botWindows.map((row) => ({
      start: row.start.getTime(),
      end: row.end.getTime(),
    })),
    tolerance: {
      openMs: tolerance.relayMs,
      closeMs: tolerance.relayMs,
      // Only credited windows end at a cutoff the speaker cannot see (ISSUE-806).
      terminalCloseMs: tolerance.relayMs,
    },
  };
}
export const transcriptRevision = async (
  tx: Pick<CaptureTx, 'select'>,
  roundId: string,
) => {
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
