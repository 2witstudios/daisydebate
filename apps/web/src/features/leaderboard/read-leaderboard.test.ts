import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readLadder } from './read-leaderboard';
setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const now = '2026-10-28T00:00:00.000Z';
test('a season without postings is empty, and no season invents no dates or standings', async () => {
  const empty = await readLadder(
    {
      readRatingBlindings: async () => [],
      listLadderSeasons: async () => [],
      readStandings: async () => ({ ratings: [], changes: [] }),
    },
    { seasonId: null, ladder: 'policy', now, username: null },
  );
  const active = await readLadder(
    {
      readRatingBlindings: async () => [],
      listLadderSeasons: async () => [
        {
          id,
          name: 'Season 1',
          startsAt: now,
          endsAt: null,
          status: 'active',
          version: 1,
        },
      ],
      readStandings: async () => ({ ratings: [], changes: [] }),
    },
    { seasonId: null, ladder: 'value', now, username: 'ada' },
  );
  assert({
    given: 'no season or an active Season1 without a rated result',
    should:
      'show no season or authoritative empty standings with actual open-ended dates',
    actual: {
      empty,
      active: active && {
        season: active.data.season,
        entries: active.data.entries,
        detail: active.debater('ada').points,
      },
    },
    expected: {
      empty: null,
      active: {
        season: {
          id,
          name: 'Season 1',
          startsAt: now,
          endsAt: null,
          status: 'active',
        },
        entries: [],
        detail: [],
      },
    },
  });
});
