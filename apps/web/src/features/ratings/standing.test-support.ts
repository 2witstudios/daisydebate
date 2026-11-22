import type { RatingEntry } from './rank';

/** An established entry with overrides, for tests. */
export const entry = (overrides: Partial<RatingEntry> = {}): RatingEntry => ({
  id: 'player',
  username: 'player',
  accountClosed: false,
  rating: 1500,
  deviation: 60,
  played: 20,
  wins: 10,
  weekChange: 0,
  seasonChange: 0,
  ...overrides,
});

export const officialRatingLadders = async () =>
  (['open', 'youth'] as const).map((lobbyId) => ({
    id: `${lobbyId}-ladder`,
    name: 'Freestyle',
    lobbyId,
    lobbyName: lobbyId === 'open' ? 'Open' : 'Youth',
    ageRule: lobbyId === 'open' ? ('adults' as const) : ('under-18' as const),
    openedAt: new Date('2026-10-01'),
  }));
