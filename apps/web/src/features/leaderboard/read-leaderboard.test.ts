import { officialRatingLadders } from '../ratings/standing.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readLadder } from './read-leaderboard';
setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const now = '2026-10-28T00:00:00.000Z';
const open = { style: 'freestyle', division: 'open' } as const;
const youth = { style: 'freestyle', division: 'youth' } as const;
test('a season without postings is empty, and no season invents no dates or standings', async () => {
  const empty = await readLadder(
    {
      readRatingBlindings: async () => [],
      listOfficialRatingLadders: officialRatingLadders,
      listLadderSeasons: async () => [],
      readStandings: async () => ({ ratings: [], changes: [] }),
    },
    { seasonId: null, ladder: open, now, username: null },
  );
  const active = await readLadder(
    {
      readRatingBlindings: async () => [],
      listOfficialRatingLadders: officialRatingLadders,
      listLadderSeasons: async () => [
        {
          id,
          name: 'Season 1',
          startsAt: now,
          endsAt: null,
          status: 'active',
          lobbyId: 'open',
          version: 1,
        },
      ],
      readStandings: async () => ({ ratings: [], changes: [] }),
    },
    { seasonId: null, ladder: open, now, username: 'ada' },
  );
  assert({
    given: 'no season or an active Season1 without a ranked result',
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

test('each division reads its own seasons', async () => {
  const youthId = 'y2v9x0f4m8q3w1z7c5n6b4d2';
  const store = {
    readRatingBlindings: async () => [],
    listOfficialRatingLadders: officialRatingLadders,
    listLadderSeasons: async (lobbyId?: string) =>
      [
        { id, name: 'Fall 2026', lobbyId: 'open' },
        { id: youthId, name: 'Youth Fall 2026', lobbyId: 'youth' },
      ]
        .filter((season) => season.lobbyId === lobbyId)
        .map((season) => ({
          ...season,
          startsAt: now,
          endsAt: null,
          status: 'active' as const,
          version: 1,
        })) as never,
    readStandings: async () => ({ ratings: [], changes: [] }),
  };
  const read = (ladder: typeof open | typeof youth, seasonId: string | null) =>
    readLadder(store, { seasonId, ladder, now, username: null }).then(
      (result) => [
        result?.ladder.division,
        result?.data.season.id,
        result?.data.seasons.map((season) => season.id),
      ],
    );
  assert({
    given:
      'an Open and a Youth season, and the Youth ladder asked for an Open season',
    should:
      'show each ladder only its own division’s seasons, falling back to its own current one',
    actual: await Promise.all([
      read(open, null),
      read(youth, null),
      read(youth, id),
    ]),
    expected: [
      ['open', id, [id]],
      ['youth', youthId, [youthId]],
      ['youth', youthId, [youthId]],
    ],
  });
});
