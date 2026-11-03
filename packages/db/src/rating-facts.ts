import type {
  RatingEligibility,
  RatingEligibilityFacts,
  RatingLadder,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
  RatingUnrated,
} from '@daisy/protocol';

/**
 * The adapter's side of the rating decision contract (ADR 0055, ADR 0058): the
 * decision it is given, and what it returns. The fact and plan shapes are
 * `@daisy/protocol`'s, shared with the engine that implements the decision.
 */

export type RatingDecision = {
  eligibility(facts: RatingEligibilityFacts): RatingEligibility;
  plan(facts: RatingPlanFacts): RatingPlan;
};

export type RateDebateResult =
  | {
      readonly kind: 'rated';
      readonly ladder: RatingLadder;
      readonly seasonId: string;
      readonly changes: readonly {
        readonly id: string;
        readonly actorId: string;
        readonly before: RatingState;
        readonly after: RatingState;
      }[];
    }
  | { readonly kind: 'already-rated' }
  | RatingUnrated;

export type RateDebateInput = {
  readonly roundId: string;
  /** cuid2 ids for the two ledger rows, affirmative first. */
  readonly changeIds: readonly [string, string];
  readonly decide: RatingDecision;
};
