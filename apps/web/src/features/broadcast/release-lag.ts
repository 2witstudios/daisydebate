import { delayAlert } from '@daisy/debate-engine';
import type { BroadcastReleasePolicy } from '@daisy/protocol';

const ms = (at: Date | null | undefined) => at?.getTime() ?? null;

/**
 * Whether a Broadcast's release has fallen past the recorded bound (ADR 0099). It
 * is read from the durable watermark here, in the web, because a dead worker is the
 * likely cause. Only a delay promises a time. The clock starts at the latest
 * attempt, and stops once everything held has been released.
 */
export const releaseOverdue = (
  broadcast: {
    readonly releasePolicy: BroadcastReleasePolicy;
    readonly egressStartedAt?: Date | null;
    readonly releasedThroughAt: Date | null;
    readonly finalMediaEndAt: Date | null;
    readonly stoppedAt: Date | null;
    readonly completedAt: Date | null;
  },
  nowMs: number,
): boolean => {
  const started = ms(broadcast.egressStartedAt);
  const released = ms(broadcast.releasedThroughAt);
  const end = ms(broadcast.finalMediaEndAt);
  if (
    broadcast.releasePolicy.kind !== 'delay' ||
    broadcast.stoppedAt !== null ||
    broadcast.completedAt !== null ||
    started === null ||
    (end !== null && released !== null && released >= end)
  )
    return false;
  return delayAlert(Math.max(started, released ?? 0), nowMs, {
    policySeconds: broadcast.releasePolicy.seconds,
  });
};
