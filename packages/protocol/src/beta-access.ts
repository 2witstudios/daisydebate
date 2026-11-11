import { z } from 'zod';

/**
 * Beta access (ADR 0075): an account's own access state, a typed account
 * authorization fact rather than a feature entitlement (DEC-19). `pending`
 * waits for an operator, `approved` may use participant capabilities and
 * `revoked` is paused. An erased account has no beta state at all.
 */
export const betaAccessStates = ['pending', 'approved', 'revoked'] as const;
export type BetaAccessState = (typeof betaAccessStates)[number];

/** How a beta access row came to exist: a sign-up, or the expand migration's cohort. */
export const betaAccessProvenances = ['signup', 'grandfathered'] as const;

/**
 * The admin app's one canonical browser origin (ADR 0077), reached through
 * `fly proxy 4800:8080`. The owner digest links here; it is not public.
 */
export const operatorConsoleOrigin = 'http://localhost:4800';

/**
 * The closed, non-personal result an operator beta access command records
 * and replays (ADR 0079): no address, no username, only states and counts.
 */
export const betaAccessCommandResultSchema = z.strictObject({
  commandId: z.string().regex(/^[a-z0-9]{24}$/),
  outcome: z.enum(['changed', 'unchanged']),
  accessState: z.enum(betaAccessStates),
  accessRevision: z.number().int().positive(),
  mail: z.enum(['queued', 'none']),
});
export type BetaAccessCommandResult = z.infer<
  typeof betaAccessCommandResultSchema
>;

/** The operator command action a beta access change is recorded under. */
export const betaAccessCommandAction = 'account.beta_access.update';

/**
 * Beta access's variant of an operator command readback: its stored result
 * and its approval mail's state (null when it owed none).
 */
export const betaAccessCommandStateSchema = z.strictObject({
  action: z.literal(betaAccessCommandAction),
  result: betaAccessCommandResultSchema,
  mailState: z
    .enum(['queued', 'leased', 'sent', 'failed', 'cancelled'])
    .nullable(),
});
export type BetaAccessCommandState = z.infer<
  typeof betaAccessCommandStateSchema
>;

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
 * revokes an account that has a beta row, or a sign-up claims its email's
 * preapproval, against the revision it last saw. A stale revision is refused, so an old approval form can never undo
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
