import type { LadderRow } from '../../../features/leaderboard/ladder-view';

/** An established, unselected row with overrides, for tests. */
export const rowFixture = (overrides: Partial<LadderRow> = {}): LadderRow => ({
  key: 'k',
  username: 'ada',
  rank: 4,
  rating: 1650,
  range: 120,
  bloom: 'full-bloom',
  provisional: false,
  wins: 12,
  losses: 5,
  change: { kind: 'flat', amount: 0 },
  me: false,
  masked: false,
  selected: false,
  href: '/leaderboard?debater=ada',
  ...overrides,
});
