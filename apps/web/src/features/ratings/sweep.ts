import type { IdGenerator } from '@daisy/clock';
import type {
  RateDebateInput,
  RateDebateResult,
  RatingCandidate,
} from '@daisy/db/ratings';
import { ratingAwaited } from '@daisy/debate-engine';
import { rateCompletedRound } from './rate-debate';

/** Bounded durable recovery for every finalized rating input, also on restart. */
export function createRatingSweep(deps: {
  readonly database: {
    readonly readRatingCandidates: (input: {
      readonly afterId?: string;
      readonly limit: number;
    }) => Promise<readonly RatingCandidate[]>;
    readonly rateRound: (input: RateDebateInput) => Promise<RateDebateResult>;
  };
  readonly ids: IdGenerator;
  readonly onFailure: (roundId: string, error: unknown) => void;
}) {
  return async (input: {
    readonly afterId?: string;
    readonly limit: number;
  }) => {
    const candidates = await deps.database.readRatingCandidates(input);
    for (const { roundId, facts } of candidates) {
      try {
        if (!ratingAwaited(facts)) continue;
        await rateCompletedRound(deps.database, roundId, deps.ids);
      } catch (error) {
        deps.onFailure(roundId, error);
      }
    }
    return {
      afterId: candidates.at(-1)?.roundId,
      exhausted: candidates.length < input.limit,
    };
  };
}
