import { buildLadder } from './ladder';
import {
  type LadderData,
  type LadderView,
  type LadderViewer,
} from './ladder-view';
import { defaultQuery, type LadderQuery } from './query';
import type { Season } from './season';
import type { LadderEntry } from './standing';
import { entry } from './standing.test-support';

export const NOW = '2026-09-30T12:00:00.000Z';

export const activeSeason: Season = {
  id: 5,
  startsAt: '2026-09-28T00:00:00.000Z',
  endsAt: '2026-10-26T00:00:00.000Z',
  status: 'active',
};

export const closedSeason: Season = {
  id: 4,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-28T00:00:00.000Z',
  status: 'closed',
};

/** `count` established debaters rated 1700 down by ten each. */
export const field = (count: number, prefix = 'p'): readonly LadderEntry[] =>
  Array.from({ length: count }, (_, i) =>
    entry({
      id: `${prefix}${String(i).padStart(3, '0')}`,
      username: `${prefix}${String(i).padStart(3, '0')}`,
      rating: 1700 - i * 10,
    }),
  );

export const dataFor = (
  entries: readonly LadderEntry[],
  season: Season = activeSeason,
): LadderData => ({
  season,
  seasons: [season],
  entries,
  previousChampion: null,
  pendingChanges: 0,
});

export const ladder = (
  entries: readonly LadderEntry[],
  query: Partial<LadderQuery> = {},
  viewer: LadderViewer | null = null,
  season: Season = activeSeason,
): LadderView =>
  buildLadder(dataFor(entries, season), { ...defaultQuery, ...query }, viewer);
