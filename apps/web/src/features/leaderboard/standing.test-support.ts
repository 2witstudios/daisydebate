import type { LadderEntry } from './standing';

/** An established entry with overrides, for tests. */
export const entry = (overrides: Partial<LadderEntry> = {}): LadderEntry => ({
  id: 'player',
  username: 'player',
  rating: 1500,
  deviation: 60,
  played: 20,
  wins: 10,
  weekChange: 0,
  seasonChange: 0,
  ...overrides,
});
