import type { BetaAccessState } from '@daisy/protocol';

export type BetaAccessDecision =
  | {
      readonly kind: 'changed';
      readonly from: BetaAccessState;
      readonly to: Exclude<BetaAccessState, 'pending'>;
      readonly revision: number;
    }
  | {
      readonly kind: 'unchanged';
      readonly state: BetaAccessState;
      readonly revision: number;
    }
  | {
      readonly kind: 'refused';
      readonly reason: 'not-found' | 'stale' | 'age-required';
    };

/**
 * The one beta access transition (ADR 0075): an operator approves or
 * revokes an account that has a beta row, against the revision it last
 * saw. A stale revision is refused, so an old approval form can never undo
 * a newer revocation; asking for the current state changes nothing; and an
 * account without a durable age record at the floor is never approved.
 */
export function decideBetaAccessChange(input: {
  readonly current: {
    readonly state: BetaAccessState;
    readonly revision: number;
  } | null;
  readonly desired: Exclude<BetaAccessState, 'pending'>;
  readonly expectedRevision: number;
  /** Whether the account's durable age record meets the floor (ISSUE-664). */
  readonly ageAdmitted: boolean;
}): BetaAccessDecision {
  const { current } = input;
  if (current === null) return { kind: 'refused', reason: 'not-found' };
  if (current.revision !== input.expectedRevision)
    return { kind: 'refused', reason: 'stale' };
  // Approval never applies without durable 16+ evidence; revoking always can.
  if (input.desired === 'approved' && !input.ageAdmitted)
    return { kind: 'refused', reason: 'age-required' };
  if (current.state === input.desired)
    return {
      kind: 'unchanged',
      state: current.state,
      revision: current.revision,
    };
  return {
    kind: 'changed',
    from: current.state,
    to: input.desired,
    revision: current.revision + 1,
  };
}
