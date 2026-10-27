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
 * and replays (ADR 0076): no address, no username, only states and counts.
 */
export const betaAccessCommandResultSchema = z.strictObject({
  commandId: z.string().regex(/^[a-z0-9]{24}$/),
  outcome: z.enum(['changed', 'unchanged']),
  accessState: z.enum(betaAccessStates),
  accessRevision: z.number().int().positive(),
  mail: z.enum(['queued', 'none']),
});
