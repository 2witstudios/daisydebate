import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type {
  CaptureTx,
  CaptureStream,
  CoverageTolerance,
} from './media-capture-context';
import {
  coalesceCreditedWindows,
  type CaptureInterval,
} from './capture-coverage';
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
/** One seat's grant in one segment, as read for the injected engine rule. */
export type SeatGrantFacts = {
  readonly seat: {
    readonly kind: 'human' | 'bot';
    readonly role: string;
    readonly slot: number;
  };
  readonly turn:
    | { readonly side?: string | undefined; readonly slot?: number | undefined }
    | undefined;
  readonly hasCreditedWindow: boolean;
};
/** The engine's rule: whether a bot's grant owes no stream. The seal and the freeze both ask it. */
export type BotGrantRule = (facts: SeatGrantFacts) => boolean;

/** Facts only, for a Round's grants or for one seat's grant in one segment. */
export async function readSeatGrants(
  tx: Pick<CaptureTx, 'execute'>,
  input: { readonly roundId: string } & Partial<CaptureStream>,
) {
  const one =
    input.segmentId !== undefined && input.roundParticipantId !== undefined;
  const rows = (await tx.execute(sql`select distinct
      i.segment_id as "segmentId", i.round_participant_id as "roundParticipantId",
      a.kind, p.role, p.slot, s.sequence,
      r.rules_snapshot->'segments'->s.sequence as turn,
      exists(select 1 from round_bot_publication_windows w
        where w.round_id=i.round_id and w.segment_id=i.segment_id
          and w.round_participant_id=i.round_participant_id) as credited
    from round_speaking_intervals i
    join round_participants p on p.id=i.round_participant_id and p.round_id=i.round_id
    join actors a on a.id=p.actor_id
    join rounds r on r.id=i.round_id
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
    turn: { side?: string; slot?: number } | null;
    credited: boolean;
  }[];
  return rows.map((row) => ({
    segmentId: row.segmentId,
    roundParticipantId: row.roundParticipantId,
    grant: {
      seat: { kind: row.kind, role: row.role, slot: row.slot },
      turn: row.turn ?? undefined,
      hasCreditedWindow: row.credited,
    } satisfies SeatGrantFacts,
  }));
}

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
    authority: coalesceCreditedWindows(
      botWindows.map((row) => ({
        start: row.start.getTime(),
        end: row.end.getTime(),
      })),
      tolerance.relayMs,
    ),
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
