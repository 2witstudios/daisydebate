import {
  broadcastPhase,
  type BroadcastFacts,
  type PhasePosition,
} from '@daisy/debate-engine';
import type { BroadcastReleasePolicy } from '@daisy/protocol';

type StoredBroadcast = {
  readonly egressId: string | null;
  readonly releasePolicy: BroadcastReleasePolicy;
  readonly observerRevokedAt: Date | null;
  readonly revocationFailures: number;
  readonly stoppedAt: Date | null;
  readonly completedAt: Date | null;
  readonly finalMediaEndAt: Date | null;
  readonly releasedThroughAt: Date | null;
};

const ms = (at: Date | null) => (at === null ? null : at.getTime());

/** Observed facts for one pass; the decision itself is `decideBroadcast`. */
export const reconcileFacts = (input: {
  readonly nowMs: number;
  readonly broadcast: StoredBroadcast;
  readonly roundStatus: BroadcastFacts['roundStatus'];
  readonly roundEndedAt: Date | null;
  readonly position: PhasePosition;
  readonly egress: BroadcastFacts['egress'];
}): BroadcastFacts => ({
  nowMs: input.nowMs,
  roundStatus: input.roundStatus,
  roundEndedAtMs: ms(input.roundEndedAt),
  stoppedAtMs: ms(input.broadcast.stoppedAt),
  completedAtMs: ms(input.broadcast.completedAt),
  egress: input.egress,
  phase: broadcastPhase(input.position),
  observerSubscribed: input.broadcast.observerRevokedAt === null,
  revocationFailures: input.broadcast.revocationFailures,
  finalMediaEndMs: ms(input.broadcast.finalMediaEndAt),
  releasedThroughMs: ms(input.broadcast.releasedThroughAt),
  policy: input.broadcast.releasePolicy,
});
