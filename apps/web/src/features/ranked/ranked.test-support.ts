import type { Sources } from './drive-match';
import type { RankedRating } from './standing';

/** Fixed sources for tests: the timings, opponent and facts never vary. */
export const testSources = (
  rating: RankedRating = { kind: 'provisional', value: 1412 },
): Sources => ({
  standing: { rating, season: { number: 3, daysLeft: 41 } },
  opponent: { handle: 'rival', rating: 1438, status: 'established' },
  timings: {
    searchSeconds: 5,
    respondSeconds: 20,
    waitingSeconds: 3,
    readySeconds: 3,
    enterSeconds: 4,
  },
  facts: { provisionalDebates: 10, checkInGraceSeconds: 40 },
});
