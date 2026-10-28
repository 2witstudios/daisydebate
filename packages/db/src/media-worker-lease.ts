import { createAppError } from '@daisy/errors';
import { nextEpoch } from './lease-policy';
import { and, eq, isNull } from 'drizzle-orm';
import {
  captureAdmission,
  captureSessionAdmits,
  lockCaptureLease,
  lockCaptureRound,
  type CaptureDependencies,
  type CaptureIdentity,
  type CaptureTx,
} from './media-capture-context';
import { mediaSessions } from './schema/media-sessions';
import { mediaVendorMutations } from './schema/media-vendor-mutations';
import { rounds } from './schema/rounds';

/** Internal lease witness only; the broker still authenticates its calling worker. */
export async function verifyMediaWorkerLease(
  tx: CaptureTx,
  input: CaptureIdentity,
  dependencies: CaptureDependencies,
  purpose: 'recover' | 'mint',
) {
  const tick = await lockCaptureRound(tx, input, dependencies);
  const [session] = await tx
    .select()
    .from(mediaSessions)
    .where(eq(mediaSessions.id, input.sessionId))
    .for('update');
  const lease = await lockCaptureLease(tx, input);
  const [round] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  const [pending] = await tx
    .select({ id: mediaVendorMutations.id })
    .from(mediaVendorMutations)
    .where(
      and(
        eq(mediaVendorMutations.sessionId, input.sessionId),
        isNull(mediaVendorMutations.settledAt),
      ),
    )
    .limit(1);
  const now = await captureAdmission(
    tx,
    input.roundId,
    tick.transcriptAdmissionCutoff,
  );
  if (
    !session ||
    !round ||
    !['scheduled', 'active'].includes(round.status) ||
    session.endedAt
  )
    throw createAppError('CONFLICT', 'Capture session has ended');
  if (lease.expiresAt <= now)
    throw createAppError('CONFLICT', 'Capture worker lease is stale');
  // Recovery must authenticate the live worker without demanding the very
  // safe vendor outcome its reconcile hold is meant to restore. Minting
  // rechecks that outcome immediately before credential construction.
  if (
    purpose === 'mint' &&
    (!captureSessionAdmits(session, {
      capturedUntil: now,
      receivedAt: now,
      sttLagMs: dependencies.sttLagMs,
    }) ||
      pending)
  )
    throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
  return {
    ...input,
    expiresAt: lease.expiresAt.toISOString(),
    serverNow: now.toISOString(),
  };
}

type LeaseRefusals = {
  readonly held: string;
  readonly stale: string;
  readonly exhausted: string;
};
/** Capture's refusal wording, which its worker tells apart. */
export const captureLeaseRefusals: LeaseRefusals = {
  held: 'Capture worker lease is held',
  stale: 'Capture worker lease is stale',
  exhausted: 'Capture worker epoch exhausted',
};

/**
 * Capture's lease claim rule on a session, as a pure decision: another
 * worker's live lease refuses as held; a
 * renewal must match this worker's live epoch, so it cannot turn an expired
 * or rotated lease into a new initial claim; a first claim takes epoch 1, a
 * live lease keeps its epoch and an expired one moves it on.
 */
export function mediaWorkerLeaseEpoch(
  current:
    | {
        readonly workerId: string;
        readonly epoch: number;
        readonly expiresAt: Date;
      }
    | undefined,
  request: {
    readonly workerId: string;
    readonly expectedEpoch?: number | undefined;
  },
  now: Date,
  refusals: LeaseRefusals,
): number {
  const live = current !== undefined && current.expiresAt > now;
  if (live && current.workerId !== request.workerId)
    throw createAppError('CONFLICT', refusals.held);
  if (
    request.expectedEpoch !== undefined &&
    !(
      live &&
      current.workerId === request.workerId &&
      current.epoch === request.expectedEpoch
    )
  )
    throw createAppError('CONFLICT', refusals.stale);
  if (!current) return 1;
  return live ? current.epoch : nextEpoch(current.epoch, refusals.exhausted);
}
