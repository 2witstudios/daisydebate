import { createAppError } from '@daisy/errors';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  captureAdmission,
  lockCaptureLease,
  requireCaptureSession,
  lockCaptureRound,
  type CaptureDependencies,
  type CaptureIdentity,
  type CaptureTx,
} from './media-capture-context';
import { roundSegments } from './schema/round-segments';
import { readSessionSeats, readSpeakingIntervals } from './media-session-reads';
import { rounds } from './schema/rounds';
import { requireLiveCaptureLease } from './capture-rules';

type ReadScope = CaptureIdentity & {
  readonly segmentId?: string | undefined;
  readonly expectedVersion?: number | undefined;
  readonly afterIntervalId?: string | undefined;
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
  const participants = await readSessionSeats(
    tx,
    input.roundId,
    input.sessionId,
  );
  const history = segment
    ? await readSpeakingIntervals(
        tx,
        input.roundId,
        segment.id,
        input.afterIntervalId,
      )
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
