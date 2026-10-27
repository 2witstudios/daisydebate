import type { IdGenerator } from '@daisy/clock';
import type { RateDebateInput, RateDebateResult } from '@daisy/db/ratings';
import { rateCompletedRound } from '../ratings/rate-debate';

/** D5 calls this after committed attendance evaluation, also on restart. */
export function createAttendanceRatingSweep(deps: {
  readonly database: {
    readonly readUnratedAttendanceForfeits: (input: {
      readonly afterId?: string;
      readonly limit: number;
    }) => Promise<readonly string[]>;
    readonly rateRound: (input: RateDebateInput) => Promise<RateDebateResult>;
  };
  readonly ids: IdGenerator;
}) {
  return async (input: {
    readonly afterId?: string;
    readonly limit: number;
  }) => {
    const roundIds = await deps.database.readUnratedAttendanceForfeits(input);
    for (const roundId of roundIds)
      await rateCompletedRound(deps.database, roundId, deps.ids);
    return {
      afterId: roundIds.at(-1),
      exhausted: roundIds.length < input.limit,
    };
  };
}
