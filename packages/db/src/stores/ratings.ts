import { instrumented } from '../instrumented';
import { readRatingCandidates, readRatingFacts } from '../rating-discovery';
import type { RateDebateInput } from '../rating-facts';
import { rateCompletedRound } from '../rating-operations';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Rating discovery and the rating writer, on the competitive lane. */
export const createRatingStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const database = lane('competitive').database;
  return namedLaneOperations({
    readRatingCandidates: (input: Parameters<typeof readRatingCandidates>[1]) =>
      readRatingCandidates(database, input),
    readRatingFacts: (roundId: string) => readRatingFacts(database, roundId),
    /**
     * Rates a completed round with the caller's domain decision (ADR 0055,
     * ADR 0058); its consumer is the ratings feature's maintenance sweep.
     */
    rateRound: (input: RateDebateInput) =>
      instrumented(eventSink, 'rateRound', () =>
        rateCompletedRound(database, input),
      ),
  });
};
export type RatingStore = ReturnType<typeof createRatingStore>;
