import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  runningEgress,
  stagePrivacyActions,
  type StageEgressFact,
  type StagePhaseFact,
} from './stage-capture';

export type BroadcastFacts = {
  readonly nowMs: number;
  readonly roundStatus: 'opening' | 'active' | 'completed' | 'abandoned';
  readonly roundEndedAtMs: number | null;
  readonly stoppedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly egress: StageEgressFact;
  readonly phase: StagePhaseFact;
  readonly observerSubscribed: boolean;
  readonly revocationFailures: number;
  readonly finalMediaEndMs: number | null;
  readonly streamEndedMs: number | null;
  readonly policy: BroadcastReleasePolicy;
};

export type BroadcastAction =
  | { readonly type: 'start-egress' }
  | {
      readonly type: 'stop-egress';
      readonly id: string;
      readonly reason: 'revocation-unconfirmed' | 'round-ended' | 'stopped';
    }
  /** A stopped Broadcast's Egress is gone: no more media will come. */
  | { readonly type: 'record-media-ended' }
  | { readonly type: 'revoke-observer' }
  /** Said again each pass: a stage joining just as it was revoked would miss it. */
  | { readonly type: 'reassert-revocation' }
  | { readonly type: 'restore-observer' }
  | { readonly type: 'complete' };

/** The delay still owed after the last media is out; a hold releases at its own time. */
const delayMs = (policy: BroadcastReleasePolicy) => policy.seconds * 1000;

/**
 * What the reconciler does next, from observed facts alone. A decision never
 * reaches the debate: the worst outcome here is a slate for the audience.
 */
export const decideBroadcast = (
  facts: BroadcastFacts,
): readonly BroadcastAction[] => {
  if (facts.completedAtMs !== null) return [];
  const live = runningEgress(facts.egress);
  if (facts.stoppedAtMs !== null)
    return live
      ? [{ type: 'stop-egress', id: live.id, reason: 'stopped' }]
      : facts.finalMediaEndMs === null
        ? [{ type: 'record-media-ended' }]
        : [];
  if (facts.roundStatus === 'completed' || facts.roundStatus === 'abandoned') {
    if (live)
      return [{ type: 'stop-egress', id: live.id, reason: 'round-ended' }];
    // No Egress left to stop, as when it failed or never started: media has ended.
    if (facts.finalMediaEndMs === null) return [{ type: 'record-media-ended' }];
    return facts.finalMediaEndMs !== null &&
      facts.streamEndedMs !== null &&
      facts.nowMs >= facts.finalMediaEndMs + delayMs(facts.policy)
      ? [{ type: 'complete' }]
      : [];
  }
  const privacy = stagePrivacyActions(facts);
  if (privacy.length > 0 || live) return privacy;
  return [{ type: 'start-egress' }];
};
