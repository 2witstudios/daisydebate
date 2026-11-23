import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import type {
  CaptureAdmissionPolicy,
  CaptureWriteTiming,
} from '@daisy/protocol/capture-admission';
import type { CaptureRule } from '@daisy/protocol/capture-verdict';
import { createAppError, createRefusal } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { and, eq } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaSessions } from './schema/media-sessions';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import {
  mediaWorkerLeases,
  transcriptSegments,
} from './schema/transcript-segments';
import { rounds } from './schema/rounds';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import type { Tx } from './tx';
import { captureDigest } from './media-capture';

export type CaptureIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
export type CaptureStream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
};
export type CaptureDependencies = {
  readonly decisionRelease?: DecisionReleasePolicy | undefined;
  readonly admission: CaptureAdmissionPolicy;
  /** Explicit local qualification admission; absent in production composition. */
  readonly evidence?: {
    readonly leaseMs: number;
    readonly nextToken: () => string;
    readonly maxRoundBytes: number;
    readonly maxGlobalBytes: number;
    readonly maxOutstandingIntents: number;
  };
  readonly run: BoundedTransaction;
  /** Injected policy: how long after a session closes earlier audio may still arrive (CAP-E.1-r8). */
  readonly sttLagMs: number;
  /** The engine's decisions on capture evidence (DEC-212, DEC-218, DEC-220). */
  readonly captureRule: CaptureRule;
  /** Told each seal's facts, for the log. */
  readonly sealed?: (fact: {
    readonly roundId: string;
    readonly sessionId: string;
    readonly cause: string;
    readonly windows: number;
    readonly captureStartMs: number | null;
  }) => void;
  readonly nextId: () => string;
  readonly buildProjection: LockedRoundTickInput['buildProjection'];
};
export const validCaptureIds = (...ids: readonly string[]) => {
  if (!ids.every((id) => idSchema.safeParse(id).success))
    throw createAppError('VALIDATION');
};
export async function lockCaptureRound(
  tx: Tx,
  input: { readonly roundId: string; readonly sessionId: string },
  dependencies: CaptureDependencies,
) {
  validCaptureIds(input.roundId, input.sessionId);
  const tick = await executeLockedRoundTick(tx, {
    decisionRelease: dependencies.decisionRelease,
    roundId: input.roundId,
    buildProjection: dependencies.buildProjection,
  });
  const [session] = await tx
    .select({ id: mediaSessions.id })
    .from(mediaSessions)
    .where(
      and(
        eq(mediaSessions.id, input.sessionId),
        eq(mediaSessions.roundId, input.roundId),
      ),
    );
  if (!session) throw createAppError('NOT_FOUND');
  return tick;
}
export async function captureAdmission(
  tx: Tx,
  roundId: string,
  cutoff: string | null,
  dependencies: CaptureDependencies,
) {
  const [freeze] = await tx
    .select({ id: roundTranscriptFreezes.roundId })
    .from(roundTranscriptFreezes)
    .where(eq(roundTranscriptFreezes.roundId, roundId));
  const [round] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  const now = await sampleRoundExecutionTime(tx);
  if (
    dependencies.admission.closed({
      frozen: freeze !== undefined,
      roundStatus: round?.status,
      now,
      cutoff,
    })
  )
    throw createRefusal(
      'CONFLICT',
      'capture-closed',
      'Capture admission is closed',
    );
  return new Date(now);
}
/** Refuses work the session no longer admits; shares the Round lock already held. */
export async function requireCaptureSession(
  tx: Tx,
  input: { readonly sessionId: string },
  dependencies: CaptureDependencies,
  write?: CaptureWriteTiming,
) {
  const [session] = await tx
    .select({
      endedAt: mediaSessions.endedAt,
      unsafeAt: mediaSessions.unsafeAt,
      deletionRequestedAt: mediaSessions.deletionRequestedAt,
    })
    .from(mediaSessions)
    .where(eq(mediaSessions.id, input.sessionId));
  if (!session || !dependencies.admission.sessionAdmits(session, write))
    throw createRefusal(
      'CONFLICT',
      'capture-paused',
      'Capture session is closed',
    );
}
export async function lockCaptureLease(tx: Tx, input: CaptureIdentity) {
  validCaptureIds(input.workerId);
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 1)
    throw createAppError('VALIDATION');
  const [lease] = await tx
    .select()
    .from(mediaWorkerLeases)
    .where(eq(mediaWorkerLeases.sessionId, input.sessionId))
    .for('update');
  if (
    !lease ||
    lease.workerId !== input.workerId ||
    lease.epoch !== input.epoch
  )
    throw createAppError('CONFLICT', 'Capture worker lease is stale');
  return lease;
}
/** A bot seat is never captured: its words are authored (ADR 0122). */
async function refuseBotSeat(
  tx: Tx,
  input: Pick<
    CaptureIdentity & CaptureStream,
    'roundId' | 'roundParticipantId'
  >,
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
  if (seat?.kind === 'bot')
    throw createRefusal('CONFLICT', 'bot-authored', 'A bot is never captured');
}
async function lockCaptureStream(
  tx: Tx,
  input: CaptureIdentity & CaptureStream,
) {
  validCaptureIds(input.segmentId, input.roundParticipantId);
  const [segment] = await tx
    .select()
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.id, input.segmentId),
        eq(roundSegments.roundId, input.roundId),
      ),
    )
    .for('update');
  if (!segment) throw createAppError('NOT_FOUND');
  const created = await tx
    .insert(transcriptSegments)
    .values({
      roundId: input.roundId,
      segmentId: input.segmentId,
      roundParticipantId: input.roundParticipantId,
    })
    .onConflictDoNothing()
    .returning({ segmentId: transcriptSegments.segmentId });
  const [stream] = await tx
    .select()
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.segmentId, input.segmentId),
        eq(transcriptSegments.roundParticipantId, input.roundParticipantId),
      ),
    )
    .for('update');
  if (!stream || stream.roundId !== input.roundId)
    throw createAppError('CONFLICT');
  // A bot's transcript is authored from its own text, never captured (ADR 0122).
  // An open stream that already existed was checked when capture made it: a
  // bot's stream is only ever made by its authored speech, already sealed.
  if (created.length > 0 || stream.state !== 'open')
    await refuseBotSeat(tx, input);
  return { segment, stream, created: created.length > 0 };
}
export async function captureWriteContext(
  tx: Tx,
  input: CaptureIdentity & CaptureStream,
  dependencies: CaptureDependencies,
  /** The end of the audio this write records; none for a seal. */
  capturedUntil?: Date,
) {
  const tick = await lockCaptureRound(tx, input, dependencies);
  const lease = await lockCaptureLease(tx, input);
  const stream = await lockCaptureStream(tx, input);
  const now = await captureAdmission(
    tx,
    input.roundId,
    tick.transcriptAdmissionCutoff,
    dependencies,
  );
  await requireCaptureSession(
    tx,
    input,
    dependencies,
    capturedUntil && {
      capturedUntil,
      receivedAt: now,
      sttLagMs: dependencies.sttLagMs,
    },
  );
  requireLiveCaptureLease(lease.expiresAt, now);
  return {
    ...stream,
    now,
    cutoff: tick.transcriptAdmissionCutoff,
    leaseExpiresAt: lease.expiresAt,
  };
}

/** Resample after evidence reads, immediately before the durable mutation. */
export async function freshCaptureMutation(
  tx: Tx,
  roundId: string,
  context: {
    readonly cutoff: string | null;
    readonly leaseExpiresAt: Date;
  },
  dependencies: CaptureDependencies,
) {
  const now = await captureAdmission(tx, roundId, context.cutoff, dependencies);
  requireLiveCaptureLease(context.leaseExpiresAt, now);
  return now;
}

/** A clip is keyed by its position and its body by every captured field. */
export function clipDigests(clip: {
  readonly roundId: string;
  readonly segmentId: string;
  readonly roundParticipantId: string;
  readonly trackId: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly text: string;
  readonly before: string;
  readonly after: string;
}) {
  const clipKey = captureDigest([
    clip.roundId,
    clip.segmentId,
    clip.roundParticipantId,
    clip.trackId,
    clip.startOffsetMs,
  ]);
  return {
    clipKey,
    bodyDigest: captureDigest([
      clipKey,
      clip.durationMs,
      clip.text,
      clip.before,
      clip.after,
    ]),
  };
}

/**
 * A sealed stream accepts only the identical seal again. An open stream never
 * seals below its stored chunks, and its count integrity is checked before timeline eligibility.
 */
export function sealIntegrity(
  stream: {
    readonly state: string;
    readonly chunkCount: number;
    readonly sealedChunkCount: number | null;
  },
  expectedChunkCount: number,
  /** Stored chunks this worker cannot count; each makes the seal partial. */
  uncounted: {
    readonly otherEpochChunks: number;
    readonly framesLost: boolean;
  } = {
    otherEpochChunks: 0,
    framesLost: false,
  },
): 'retry' | 'seal' {
  // A worker counts only the chunks it saw answered. An earlier epoch's are
  // added, and a worker reporting loss may have written one it never heard back
  // about, so it may not reach the stored count. Otherwise it must.
  const reaches = (count: number) =>
    uncounted.framesLost ||
    expectedChunkCount + uncounted.otherEpochChunks >= count;
  if (stream.state !== 'open') {
    const sealed = stream.sealedChunkCount;
    if (sealed === null || expectedChunkCount > sealed || !reaches(sealed))
      throw createAppError('CONFLICT', 'Conflicting capture seal retry');
    return 'retry';
  }
  if (!reaches(stream.chunkCount))
    throw createAppError('CONFLICT', 'Capture seal is below stored chunks');
  return 'seal';
}

export function requireLiveCaptureLease(expiresAt: Date, now: Date): void {
  if (expiresAt <= now)
    throw createRefusal(
      'CONFLICT',
      'lease-expired',
      'Capture worker lease expired',
    );
}
