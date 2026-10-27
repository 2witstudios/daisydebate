import type {
  CoachingClaimDecision,
  RoundCoachingFacts,
} from '@daisy/db/rounds';
import {
  debateSides,
  type DebateSide,
  type RoundCoaching,
} from '@daisy/protocol';

/**
 * The coaching pass's bounds (ADR 0071): a Round is coached only within the
 * window after it completes, and buys at most `maxCalls` paid calls.
 */
export const coachingPolicy = {
  windowMs: 24 * 60 * 60 * 1000,
  maxCalls: 2,
} as const;
export type CoachingPolicy = typeof coachingPolicy;

/** A submitted AI ballot already gave this side feedback. */
const aiCoached = (facts: RoundCoachingFacts, side: DebateSide) =>
  facts.aiBallots.some(
    (ballot) => ballot.submitted && ballot.sides.includes(side),
  );

/**
 * Whether a Round needs the coaching pass at `now`: completed within the
 * window, with frozen lines to coach from, and not already coached on both
 * sides by a submitted AI ballot. A completed Round takes no more ballots,
 * so nothing still to be judged can coach it later.
 */
export function coachingNeeded(
  facts: RoundCoachingFacts,
  now: string,
  policy: CoachingPolicy = coachingPolicy,
): boolean {
  if (facts.status !== 'completed' || facts.completedAt === null) return false;
  const age = Date.parse(now) - Date.parse(facts.completedAt);
  return (
    age < policy.windowMs &&
    facts.frozen &&
    facts.lines > 0 &&
    !debateSides.every((side) => aiCoached(facts, side))
  );
}

/** A held lease that has run out at `now`. */
const lapsed = (facts: RoundCoachingFacts, now: string) =>
  facts.pass?.status === 'leased' &&
  facts.pass.leaseExpiresAt !== null &&
  Date.parse(facts.pass.leaseExpiresAt) <= Date.parse(now);

/**
 * What a claim does with a Round: take its next paid attempt, end a lapsed
 * lease that may buy no more (spent, or no longer needed), or leave it.
 */
export function claimDecision(
  facts: RoundCoachingFacts,
  now: string,
  policy: CoachingPolicy = coachingPolicy,
): CoachingClaimDecision {
  const { pass } = facts;
  if (pass && !lapsed(facts, now)) return 'skip';
  const needed = coachingNeeded(facts, now, policy);
  if (pass && (pass.attempts >= policy.maxCalls || !needed)) return 'fail';
  return needed ? 'claim' : 'skip';
}

/**
 * A debater's coaching state: the AI judge's ballot when it coached their
 * side, else the pass's text, pending while a pass is running or will run in
 * this deployment, else unavailable.
 */
export function coachingView(input: {
  readonly facts: RoundCoachingFacts;
  readonly side: DebateSide;
  readonly now: string;
  /** Whether this deployment runs the coaching pass. */
  readonly enabled: boolean;
  readonly policy?: CoachingPolicy;
}): RoundCoaching | null {
  const { facts, side, now } = input;
  if (facts.status !== 'completed') return null;
  if (aiCoached(facts, side)) return { status: 'in-ballot' };
  return passView(
    facts,
    side,
    now,
    input.enabled,
    input.policy ?? coachingPolicy,
  );
}

/** The coaching pass's state for a side the AI judge did not coach. */
function passView(
  facts: RoundCoachingFacts,
  side: DebateSide,
  now: string,
  enabled: boolean,
  policy: CoachingPolicy,
): RoundCoaching {
  const { pass } = facts;
  const text = pass?.feedback?.[side];
  if (pass?.status === 'succeeded' && text) return { status: 'ready', text };
  const runs = pass
    ? pass.status === 'leased' && claimDecision(facts, now, policy) !== 'fail'
    : enabled && coachingNeeded(facts, now, policy);
  return { status: runs ? 'pending' : 'unavailable' };
}
