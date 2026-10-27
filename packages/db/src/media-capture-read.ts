import { createAppError } from '@daisy/errors';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import {
  captureAdmission,
  lockCaptureLease,
  requireCaptureSession,
  lockCaptureRound,
  type CaptureDependencies,
  type CaptureIdentity,
  type CaptureTx,
} from './media-capture-context';
import { roundParticipants } from './schema/round-participants';
import { mediaParticipants } from './schema/media-sessions';
import { actors } from './schema/actors';
import { roundSegments } from './schema/round-segments';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import { rounds } from './schema/rounds';
import { requireLiveCaptureLease } from './capture-rules';

type ReadScope = CaptureIdentity & {
  readonly segmentId?: string | undefined;
  readonly expectedVersion?: number | undefined;
  readonly afterIntervalId?: string | undefined;
};
const historyPage = async (
  tx: CaptureTx,
  input: ReadScope,
  segmentId: string,
) => {
  const rows = await tx
    .select()
    .from(roundSpeakingIntervals)
    .where(
      and(
        eq(roundSpeakingIntervals.roundId, input.roundId),
        eq(roundSpeakingIntervals.segmentId, segmentId),
        ...(input.afterIntervalId
          ? [gt(roundSpeakingIntervals.id, input.afterIntervalId)]
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
};

const segmentView = (segment: typeof roundSegments.$inferSelect | undefined) =>
  segment
    ? {
        id: segment.id,
        sequence: segment.sequence,
        type: segment.type,
        startedAt: segment.startedAt.toISOString(),
        endedAt: segment.endedAt?.toISOString() ?? null,
        durationMs: segment.durationMs,
      }
    : null;

/** Internal paged read; every page checks the same fresh committed Round version. */
export async function readMediaCaptureState(
  tx: CaptureTx,
  input: ReadScope,
  dependencies: CaptureDependencies,
) {
  const tick = await lockCaptureRound(tx, input, dependencies);
  const lease = await lockCaptureLease(tx, input);
  await requireCaptureSession(tx, input);
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== tick.resultingVersion
  )
    throw createAppError('CONFLICT', 'Capture snapshot changed');
  const [round] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  const [segment] = await tx
    .select()
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.roundId, input.roundId),
        input.segmentId
          ? eq(roundSegments.id, input.segmentId)
          : isNull(roundSegments.endedAt),
      ),
    )
    .orderBy(desc(roundSegments.sequence))
    .limit(1);
  if (input.segmentId && !segment) throw createAppError('NOT_FOUND');
  const participants = await tx
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
        eq(mediaParticipants.sessionId, input.sessionId),
      ),
    )
    .where(
      and(
        eq(roundParticipants.roundId, input.roundId),
        ne(roundParticipants.role, 'judge'),
      ),
    )
    .orderBy(roundParticipants.id);
  const history = segment
    ? await historyPage(tx, input, segment.id)
    : { intervals: [], nextIntervalId: null };
  const now = await captureAdmission(
    tx,
    input.roundId,
    tick.transcriptAdmissionCutoff,
  );
  requireLiveCaptureLease(lease.expiresAt, now);
  return {
    roundId: input.roundId,
    sessionId: input.sessionId,
    version: tick.resultingVersion,
    serverNow: now.toISOString(),
    status: round!.status,
    transcriptAdmissionCutoff: tick.transcriptAdmissionCutoff,
    participants,
    segment: segmentView(segment),
    ...history,
  };
}
