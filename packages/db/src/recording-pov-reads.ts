import type { PovBuild } from '@daisy/protocol';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { recordingPovCaptures as povs } from './schema/recording-pov-captures';
import type { BoundedTransactionContext } from './transaction-context';

/** The label's threshold: a camera this tall reached the POV's full quality. */
const FULL_QUALITY_HEIGHT = 540;

/**
 * Whether a debater's POV Egress may still be subscribed to this Round. Like an
 * observer, it holds private conversation and cameras, with no timer: an unconfirmed
 * revocation stops the Egress, and revoking one that has gone then confirms.
 */
export const readPovSubscribed = async (
  tx: BoundedTransactionContext,
  input: { readonly roundId: string },
): Promise<boolean> => {
  const [pov] = await tx
    .select({ id: povs.recordingId })
    .from(povs)
    .where(
      and(
        eq(povs.roundId, input.roundId),
        isNotNull(povs.egressId),
        isNull(povs.endedAt),
        isNull(povs.observerRevokedAt),
      ),
    )
    .limit(1);
  return pov !== undefined;
};

/**
 * What the worker needs of each debater's capture. Its login reaches its job table
 * alone, so the web copies this onto the job when it queues a build.
 */
export const readPovBuilds = async (
  tx: BoundedTransactionContext,
  recordingId: string,
): Promise<readonly PovBuild[]> => {
  const rows = await tx
    .select({
      roundParticipantId: povs.roundParticipantId,
      camera: povs.camera,
      cameraHeight: povs.cameraHeight,
      attemptCount: povs.egressGeneration,
    })
    .from(povs)
    .where(eq(povs.recordingId, recordingId))
    .orderBy(asc(povs.roundParticipantId));
  return rows.map(({ camera, cameraHeight, ...row }) => ({
    ...row,
    picture: !camera
      ? null
      : (cameraHeight ?? 0) >= FULL_QUALITY_HEIGHT
        ? ('540p' as const)
        : ('360p' as const),
  }));
};
