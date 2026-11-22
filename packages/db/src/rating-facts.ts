import type {
  RatingEligibility,
  RatingCompetition,
  RatingEligibilityFacts,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
  RatingUnrated,
} from '@daisy/protocol/ratings';
import type { SideKey } from '@daisy/protocol/seats';
import type { RoundRatingScope } from '@daisy/protocol/rating-ladder';

/**
 * The adapter's side of the rating decision contract (ADR 0055, ADR 0058): the
 * decision it is given, and what it returns. The fact and plan shapes are
 * `@daisy/protocol`'s, shared with the engine that implements the decision.
 */

export type RatingDecision = {
  eligibility(facts: RatingEligibilityFacts): RatingEligibility;
  /** Invoked after the frozen season fence, before projection locks. */
  competition(sides: readonly SideKey[]): RatingCompetition;
  /** Invoked on freshly loaded prior-season facts under projection locks. */
  requireStandingRules(input: { readonly previousWithoutRules: boolean }): void;
  plan(facts: RatingPlanFacts): RatingPlan;
};

export type RateDebateResult =
  | {
      readonly kind: 'rated';
      readonly scope: NonNullable<RoundRatingScope>;
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
  readonly nextChangeId: () => string;
  readonly decide: RatingDecision;
};
