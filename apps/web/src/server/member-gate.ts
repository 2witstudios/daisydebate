import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import { consumeOrThrow, type RateLimiter, type RateRule } from './rate-limit';
import { requireSignedIn } from './http';

export type MemberCaller = {
  readonly userId: string;
  readonly actorId: string;
};
export type MemberGateDependencies = {
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly getActorByUserId: (
    userId: string,
  ) => Promise<{ readonly id: string } | null>;
};
type Gate = {
  /** The feature's own budget; the member's id completes the key. */
  readonly bucket: string;
  readonly rule: RateRule;
  /** A waitlisted account may only withdraw (ADR 0075), so a route opts in. */
  readonly admitWaitlisted?: boolean;
  /** Refuses what cannot proceed before it spends the member's budget. */
  readonly beforeBudget?: () => void;
};

/**
 * Session, member, rate budget and current actor, in that order (ADR 0020),
 * for a route that acts as the member's actor at once. A route whose evaluator
 * decides from the principal uses `runMemberHandler` instead. A member identity
 * has already read this actor, so an actor that is missing or moved is a data
 * fault, never a refusal of the caller.
 */
export async function requireMember(
  dependencies: MemberGateDependencies,
  request: Request,
  { bucket, rule, admitWaitlisted = false, beforeBudget }: Gate,
): Promise<MemberCaller> {
  const identity = requireSignedIn(await dependencies.identify(request));
  if (
    identity.state !== 'member' &&
    !(admitWaitlisted && identity.state === 'waitlisted')
  )
    throw createAppError('AUTHORIZATION');
  beforeBudget?.();
  const { userId, actorId } = identity.principal;
  await consumeOrThrow(dependencies.limiter(), `${bucket}:${userId}`, rule);
  const actor = await dependencies.getActorByUserId(userId);
  if (actor?.id !== actorId) throw createAppError('INFRASTRUCTURE');
  return { userId, actorId };
}
