import type { IdGenerator } from '@daisy/clock';
import type { RateDebateInput, RateDebateResult } from '@daisy/db/ratings';
import { rateCompletedRound } from './rate-debate';

/** Bounded durable recovery for every finalized rating input, also on restart. */
export function createRatingSweep(deps: {
  readonly database: {
    readonly readUnratedRatingRounds: (input: {
      readonly afterId?: string;
      readonly limit: number;
    }) => Promise<readonly string[]>;
    readonly rateRound: (input: RateDebateInput) => Promise<RateDebateResult>;
  };
  readonly ids: IdGenerator;
  readonly onFailure: (roundId: string, error: unknown) => void;
}) {
  return async (input: {
    readonly afterId?: string;
    readonly limit: number;
  }) => {
    const roundIds = await deps.database.readUnratedRatingRounds(input);
    for (const roundId of roundIds) {
      try {
        await rateCompletedRound(deps.database, roundId, deps.ids);
      } catch (error) {
        deps.onFailure(roundId, error);
      }
    }
    return {
      afterId: roundIds.at(-1),
      exhausted: roundIds.length < input.limit,
    };
  };
}
