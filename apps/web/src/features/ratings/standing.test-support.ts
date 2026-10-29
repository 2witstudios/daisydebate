import type { RatingEntry } from '../ratings/rank';

/** An established entry with overrides, for tests. */
export const entry = (overrides: Partial<RatingEntry> = {}): RatingEntry => ({
  id: 'player',
  username: 'player',
  accountClosed: false,
  rating: 1500,
  deviation: 60,
  played: 20,
  wins: 10,
  draws: 0,
  weekChange: 0,
  seasonChange: 0,
  ...overrides,
});
