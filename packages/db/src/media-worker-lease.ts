import { createAppError } from '@daisy/errors';
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
    !captureSessionAdmits(session, {
      capturedUntil: now,
      receivedAt: now,
      sttLagMs: dependencies.sttLagMs,
    }) ||
    pending ||
    !round ||
    !['scheduled', 'active'].includes(round.status) ||
    lease.expiresAt <= now
  )
    throw createAppError('CONFLICT', 'Capture token admission is closed');
  return {
    ...input,
    expiresAt: lease.expiresAt.toISOString(),
    serverNow: now.toISOString(),
  };
}
