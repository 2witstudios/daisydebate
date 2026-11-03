/**
 * What any Egress of the stage page must obey, whoever runs it: a Broadcast or a
 * Recording with no Broadcast. The observer's permission is the privacy boundary;
 * the page's slate is only appearance.
 */

/** Revocation must land at least this far ahead of a private phase (BCAST-1). */
export const REVOCATION_LEAD_MS = 500;

export type StageEgressFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'starting' | 'active'; readonly id: string }
  | { readonly kind: 'failed'; readonly id: string }
  | { readonly kind: 'complete' };

export type StagePhaseFact =
  | { readonly kind: 'public' }
  | { readonly kind: 'private-at'; readonly atMs: number }
  | { readonly kind: 'private' };

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
export const stagePrivacyActions = (facts: {
  readonly nowMs: number;
  readonly egress: StageEgressFact;
  readonly phase: StagePhaseFact;
  readonly observerSubscribed: boolean;
  readonly revocationFailures: number;
}): readonly StagePrivacyAction[] => {
  const live = runningEgress(facts.egress);
  const privateSoon =
    facts.phase.kind === 'private' ||
    (facts.phase.kind === 'private-at' &&
      facts.phase.atMs - facts.nowMs <= REVOCATION_LEAD_MS);
  if (!privateSoon)
    return facts.observerSubscribed ? [] : [{ type: 'restore-observer' }];
  if (!facts.observerSubscribed)
    return live ? [{ type: 'reassert-revocation' }] : [];
  if (!live) return [{ type: 'revoke-observer' }];
  // A private phase can open with no warning (a debater takes prep). Its mic
  // closes by grant and conversation stays held until the revocation lands, so
  // revoking is safe; only a revocation that failed stops the Egress.
  return facts.revocationFailures > 0
    ? [{ type: 'stop-egress', id: live.id, reason: 'revocation-unconfirmed' }]
    : [{ type: 'revoke-observer' }];
};
