import type { BroadcastReleasePolicy } from '@daisy/protocol';

/** Revocation must land at least this far ahead of a private phase (BCAST-1). */
export const REVOCATION_LEAD_MS = 500;

type EgressFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'starting' | 'active'; readonly id: string }
  | { readonly kind: 'failed'; readonly id: string }
  | { readonly kind: 'complete' };

type PhaseFact =
  | { readonly kind: 'public' }
  | { readonly kind: 'private-at'; readonly atMs: number }
  | { readonly kind: 'private' };

export type BroadcastFacts = {
  readonly nowMs: number;
  readonly roundStatus: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly roundEndedAtMs: number | null;
  readonly stoppedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly egress: EgressFact;
  readonly phase: PhaseFact;
  readonly observerSubscribed: boolean;
  readonly revocationFailures: number;
  readonly finalMediaEndMs: number | null;
  readonly releasedThroughMs: number | null;
  readonly policy: BroadcastReleasePolicy;
};

export type BroadcastAction =
  | { readonly type: 'start-egress' }
  | {
      readonly type: 'stop-egress';
      readonly id: string;
      readonly reason: 'revocation-unconfirmed' | 'round-ended' | 'stopped';
    }
  | { readonly type: 'revoke-observer' }
  | { readonly type: 'restore-observer' }
  | { readonly type: 'complete' };

const running = (egress: EgressFact) =>
  egress.kind === 'starting' || egress.kind === 'active' ? egress : null;

/** The delay still owed after the last media is out; a hold releases at its own time. */
const delayMs = (policy: BroadcastReleasePolicy) =>
  policy.kind === 'delay' ? policy.seconds * 1000 : 0;

const privacyActions = (facts: BroadcastFacts): readonly BroadcastAction[] => {
  const live = running(facts.egress);
  const privateSoon =
    facts.phase.kind === 'private' ||
    (facts.phase.kind === 'private-at' &&
      facts.phase.atMs - facts.nowMs <= REVOCATION_LEAD_MS);
  if (!privateSoon)
    return facts.observerSubscribed || facts.phase.kind !== 'public'
      ? []
      : [{ type: 'restore-observer' }];
  if (!facts.observerSubscribed) return [];
  if (!live) return [{ type: 'revoke-observer' }];
  return facts.phase.kind === 'private' || facts.revocationFailures > 0
    ? [{ type: 'stop-egress', id: live.id, reason: 'revocation-unconfirmed' }]
    : [{ type: 'revoke-observer' }];
};

/**
 * What the reconciler does next, from observed facts alone. A decision never
 * reaches the debate: the worst outcome here is a slate for the audience.
 */
export const decideBroadcast = (
  facts: BroadcastFacts,
): readonly BroadcastAction[] => {
  if (facts.completedAtMs !== null) return [];
  const live = running(facts.egress);
  if (facts.stoppedAtMs !== null)
    return live
      ? [{ type: 'stop-egress', id: live.id, reason: 'stopped' }]
      : [];
  if (facts.roundStatus === 'completed' || facts.roundStatus === 'abandoned') {
    if (live)
      return [{ type: 'stop-egress', id: live.id, reason: 'round-ended' }];
    return facts.finalMediaEndMs !== null &&
      facts.releasedThroughMs !== null &&
      facts.releasedThroughMs >= facts.finalMediaEndMs &&
      facts.nowMs >= facts.finalMediaEndMs + delayMs(facts.policy)
      ? [{ type: 'complete' }]
      : [];
  }
  const privacy = privacyActions(facts);
  if (privacy.length > 0 || live) return privacy;
  return [{ type: 'start-egress' }];
};
