import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type { CaptureTx, CaptureStream } from './media-capture-context';
import {
  speakingEndMs,
  type CaptureInterval,
  type CaptureRule,
  type SeatGrantFacts,
} from '@daisy/protocol';
import { rounds } from './schema/rounds';
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
  segment: Pick<Segment, 'startedAt' | 'endedAt' | 'durationMs' | 'returnedMs'>,
) {
  const segmentStart = segment.startedAt.getTime();
  const segmentEnd = speakingEndMs({
    startedAtMs: segmentStart,
    endedAtMs: segment.endedAt?.getTime() ?? null,
    durationMs: segment.durationMs,
    returnedMs: segment.returnedMs,
  });
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
/** Facts only, for a Round's grants or for one seat's grant in one segment. */
export async function readSeatGrants(
  tx: Pick<CaptureTx, 'execute' | 'select'>,
  input: { readonly roundId: string } & Partial<CaptureStream>,
) {
  const [round] = await tx
    .select({ rules: rounds.rulesSnapshot })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  const one =
    input.segmentId !== undefined && input.roundParticipantId !== undefined;
  const rows = (await tx.execute(sql`select distinct
      i.segment_id as "segmentId", i.round_participant_id as "roundParticipantId",
      a.kind, p.role, p.slot, s.sequence,
      exists(select 1 from utterances u
        where u.round_id=i.round_id and u.segment_id=i.segment_id
          and u.round_participant_id=i.round_participant_id
          and u.bot_phrase_id is not null) as authored
    from round_speaking_intervals i
    join round_participants p on p.id=i.round_participant_id and p.round_id=i.round_id
    join actors a on a.id=p.actor_id
    left join round_segments s on s.round_id=i.round_id and s.id=i.segment_id
    where i.round_id=${input.roundId} and p.role<>'judge'
      and (i.ended_at is null or i.ended_at>i.started_at)
      ${one ? sql`and i.segment_id=${input.segmentId} and i.round_participant_id=${input.roundParticipantId}` : sql``}
    order by i.segment_id, i.round_participant_id`)) as unknown as {
    segmentId: string;
    roundParticipantId: string;
    kind: 'human' | 'bot';
    role: string;
    slot: number;
    sequence: number | null;
    authored: boolean;
  }[];
  return rows.map((row) => ({
    segmentId: row.segmentId,
    roundParticipantId: row.roundParticipantId,
    grant: {
      seat: { kind: row.kind, role: row.role, slot: row.slot },
      turn:
        row.sequence === null ? undefined : round?.rules.segments[row.sequence],
      hasAuthoredSpeech: row.authored,
    } satisfies SeatGrantFacts,
  }));
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
