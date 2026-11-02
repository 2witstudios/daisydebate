import { and, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { grantWindows } from './capture-history';
import type { CaptureRule } from './capture-rule';
import { actors } from './schema/actors';
import { roundBotPublicationWindows } from './schema/round-bot-publications';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import { transcriptObservations } from './schema/transcript-segments';

type Reader = Pick<BunSQLDatabase, 'select'>;
type Stream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
};
export const streamKey = (stream: Stream) =>
  JSON.stringify([stream.segmentId, stream.roundParticipantId]);
const groupBy = <T>(rows: readonly T[], of: (row: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const row of rows)
    groups.set(of(row), [...(groups.get(of(row)) ?? []), row]);
  return groups;
};

/**
 * The gaps of a Round's closed streams, as offsets into each speech, in a fixed
 * number of reads however many streams fell short. A closed stream's open grant
 * ended with its segment's speaking time: nothing more was owed.
 */
export async function closedStreamGaps(
  tx: Reader,
  roundId: string,
  streams: readonly Stream[],
  rule: CaptureRule,
) {
  const found = new Map<
    string,
    readonly { readonly fromOffsetMs: number; readonly untilOffsetMs: number }[]
  >();
  if (!streams.length) return found;
  const segmentIds = [...new Set(streams.map((stream) => stream.segmentId))];
  const segments = await tx
    .select()
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.roundId, roundId),
        inArray(roundSegments.id, segmentIds),
      ),
    );
  const grants = await tx
    .select()
    .from(roundSpeakingIntervals)
    .where(
      and(
        eq(roundSpeakingIntervals.roundId, roundId),
        inArray(roundSpeakingIntervals.segmentId, segmentIds),
      ),
    );
  const observed = await tx
    .select({
      segmentId: transcriptObservations.segmentId,
      roundParticipantId: transcriptObservations.roundParticipantId,
      start: transcriptObservations.observedFrom,
      end: transcriptObservations.observedUntil,
    })
    .from(transcriptObservations)
    .where(
      and(
        eq(transcriptObservations.roundId, roundId),
        inArray(transcriptObservations.segmentId, segmentIds),
      ),
    );
  const seats = await tx
    .select({ id: roundParticipants.id, kind: actors.kind })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .where(eq(roundParticipants.roundId, roundId));
  const windows = await tx
    .select({
      segmentId: roundBotPublicationWindows.segmentId,
      roundParticipantId: roundBotPublicationWindows.roundParticipantId,
      start: roundBotPublicationWindows.creditedFrom,
      end: roundBotPublicationWindows.creditedUntil,
    })
    .from(roundBotPublicationWindows)
    .where(
      and(
        eq(roundBotPublicationWindows.roundId, roundId),
        inArray(roundBotPublicationWindows.segmentId, segmentIds),
      ),
    );
  const grantsOf = groupBy(grants, streamKey);
  const observedOf = groupBy(observed, streamKey);
  const windowsOf = groupBy(windows, streamKey);
  for (const stream of streams) {
    const segment = segments.find((row) => row.id === stream.segmentId);
    if (!segment) continue;
    const startMs = segment.startedAt.getTime();
    const speakingEndMs = Math.min(
      segment.endedAt?.getTime() ?? Infinity,
      startMs + segment.durationMs,
    );
    const kind = seats.find(
      (seat) => seat.id === stream.roundParticipantId,
    )?.kind;
    const coverage = rule.coverage(
      kind === 'bot' ? 'bot' : 'human',
      grantWindows(grantsOf.get(streamKey(stream)) ?? [], segment).map(
        (grant) => ({
          start: grant.start,
          end: grant.end ?? speakingEndMs,
        }),
      ),
      (windowsOf.get(streamKey(stream)) ?? []).map((row) => ({
        start: row.start.getTime(),
        end: row.end.getTime(),
      })),
    );
    found.set(
      streamKey(stream),
      rule
        .gaps(
          coverage,
          (observedOf.get(streamKey(stream)) ?? []).map((row) => ({
            start: row.start.getTime(),
            end: row.end.getTime(),
          })),
        )
        .map((gap) => ({
          fromOffsetMs: Math.max(0, gap.start - startMs),
          untilOffsetMs: Math.max(0, gap.end - startMs),
        })),
    );
  }
  return found;
}
