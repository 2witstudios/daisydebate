import type {
  MatchOpponent,
  MatchTimings,
} from '../../features/ranked/match-flow';
import type { RankedFacts } from '../../features/ranked/rules';
import type { RankedStanding } from '../../features/ranked/standing';

/**
 * Sample data for the Ranked destination. Every number here is a stand-in:
 * the season, the provisional threshold and the offer timings have no
 * backend yet, and the opponent is a made-up handle.
 */

/** The signed-in viewer's sample standing: provisional, mid-season. */
export const sampleStanding: RankedStanding = {
  rating: { kind: 'provisional', value: 1412 },
  season: { number: 3, daysLeft: 41 },
};

/** The one sample opponent a mock match offer always shows. */
export const sampleOpponent: MatchOpponent = {
  handle: 'debater-b',
  rating: 1438,
  status: 'established',
};

/** Sample seconds each matchmaking step shows before the mock moves on. */
export const sampleMatchTimings: MatchTimings = {
  searchSeconds: 5,
  respondSeconds: 20,
  waitingSeconds: 3,
  readySeconds: 3,
  enterSeconds: 4,
};

/**
 * Facts the rules copy states. The check-in grace is the ADR 0033 default;
 * the provisional threshold is a placeholder until the Ratings epic sets it.
 */
export const sampleRankedFacts: RankedFacts = {
  provisionalDebates: 10,
  checkInGraceSeconds: 40,
};
