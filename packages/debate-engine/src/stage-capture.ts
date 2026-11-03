/**
 * What any Egress in a Round's room must obey, whoever runs it: a Broadcast's stage,
 * a Recording's own stage, or a debater's POV. Its subscribe permission is the
 * privacy boundary; a stage page's slate is only appearance.
 */

/**
 * How far ahead of a scheduled private phase the sweep revokes. None: every word of
 * the last speech is kept, because the conversation hold closes microphones and
 * cameras until the revocation lands. A staging measurement that finds a leak
 * raises this one value (ADR 0099).
 */
const REVOCATION_AHEAD_MS = 0;

export type StageEgressFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'starting' | 'active'; readonly id: string }
  | { readonly kind: 'failed'; readonly id: string }
  | { readonly kind: 'complete' };

export type StagePhaseFact =
  | { readonly kind: 'public' }
  | { readonly kind: 'private-at'; readonly atMs: number }
  | { readonly kind: 'private' };

/** The one reading of a phase at an instant: the sweep's and the grants' alike. */
export const phasePrivateAt = (phase: StagePhaseFact, nowMs: number) =>
  phase.kind === 'private' ||
  (phase.kind === 'private-at' && phase.atMs - nowMs <= REVOCATION_AHEAD_MS);

export const runningEgress = (egress: StageEgressFact) =>
  egress.kind === 'starting' || egress.kind === 'active' ? egress : null;

export type StagePrivacyAction =
  | { readonly type: 'revoke-observer' }
  | { readonly type: 'restore-observer' }
  /** Said again each pass: a stage joining just as it was revoked would miss it. */
  | { readonly type: 'reassert-revocation' }
  | {
      readonly type: 'stop-egress';
      readonly id: string;
      readonly reason: 'revocation-unconfirmed';
    };

/** The next step of the privacy boundary, from observed facts alone. */
export const egressPrivacyActions = (facts: {
  readonly nowMs: number;
  readonly egress: StageEgressFact;
  readonly phase: StagePhaseFact;
  readonly observerSubscribed: boolean;
  readonly revocationFailures: number;
}): readonly StagePrivacyAction[] => {
  const live = runningEgress(facts.egress);
  if (!phasePrivateAt(facts.phase, facts.nowMs))
    return facts.observerSubscribed ? [] : [{ type: 'restore-observer' }];
  if (!facts.observerSubscribed)
    return live ? [{ type: 'reassert-revocation' }] : [];
  if (!live) return [{ type: 'revoke-observer' }];
  // Revocation comes at or after the phase opens. Its mics and cameras close by
  // grant and stay held until the revocation lands, so that is safe; only a
  // revocation that failed stops the Egress.
  return facts.revocationFailures > 0
    ? [{ type: 'stop-egress', id: live.id, reason: 'revocation-unconfirmed' }]
    : [{ type: 'revoke-observer' }];
};
