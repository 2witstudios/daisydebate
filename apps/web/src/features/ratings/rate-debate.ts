import type { IdGenerator } from '@daisy/clock';
import type {
  RateDebateInput,
  RateDebateResult,
  RatingDecision,
} from '@daisy/db/ratings';
import {
  planRating,
  ratingEligibility,
  ratingCompetition,
  requireRatingStandingRules,
} from '@daisy/debate-engine';

/** The engine's rating rules in the shape the adapter asks for (ADR 0055). */
const ratingDecision: RatingDecision = {
  eligibility: ratingEligibility,
  competition: ratingCompetition,
  requireStandingRules: requireRatingStandingRules,
  plan: planRating,
};

/**
 * Rates a completed round on its frozen ladder: the adapter locks and
 * writes, the engine decides. Idempotent, so a caller may retry it. The
 * maintenance rating sweep uses it for every finalized result, judged or
 * forfeited. Ledger ids come from the caller's id source.
 */
export function rateCompletedRound(
  database: {
    readonly rateRound: (input: RateDebateInput) => Promise<RateDebateResult>;
  },
  roundId: string,
  ids: IdGenerator,
): Promise<RateDebateResult> {
  return database.rateRound({
    roundId,
    nextChangeId: () => ids.next(),
    decide: ratingDecision,
  });
}
