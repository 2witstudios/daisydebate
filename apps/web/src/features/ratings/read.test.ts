import { officialRatingLadders } from './standing.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRatingStandings, type RatingReadStore } from './read';
setupRitewayBun();
const at = '2026-10-28T00:00:00.000Z';
const season = {
  id: 's'.repeat(24),
  name: 'Season 1',
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: at,
  status: 'closed' as const,
  lobbyId: 'open' as const,
  version: 1,
};
const open = { style: 'freestyle', division: 'open' } as const;
const source = (rating = 1888.125) => ({
  ratings: [
    {
      seasonId: season.id,
      actorId: 'actor-a',
      username: 'ada',
      accountClosed: false,
      rating,
      deviation: 110,
      volatility: 0.06,
    },
  ],
  changes: [
    {
      seasonId: season.id,
      actorId: 'actor-a',
      roundId: 'round-a',
      ratingBefore: 1500,
      ratingAfter: rating,
      deviationBefore: 350,
      deviationAfter: 110,
      occurredAt: at,
      side: 'affirmative' as const,
      outcome: { kind: 'winner' as const, side: 'affirmative' },
    },
  ],
});
const store = (blinded: readonly string[] = []): RatingReadStore => ({
  listOfficialRatingLadders: officialRatingLadders,
  listLadderSeasons: async (lobbyId) => (lobbyId === 'open' ? [season] : []),
  readStandings: async () => source(),
  readRatingBlindings: async () => blinded,
});

test('closed-season standings and classification never drift with later read time', async () => {
  const input = {
    ladder: open,
    seasonId: season.id,
    now: '2026-10-29T00:00:00.000Z',
  };
  const first = await readRatingStandings(store(), input);
  const later = await readRatingStandings(store(), {
    ...input,
    now: '2029-10-29T00:00:00.000Z',
  });
  assert({
    given: 'a closed season ending with exactlyRD110',
    should: 'preserve final rank, uncertainty and movement at its end instant',
    actual: [
      first?.entriesBySeason,
      later?.entriesBySeason[season.id]?.[0]?.provisional,
    ],
    expected: [later?.entriesBySeason, false],
  });
});

test('published viewer blinding removes numeric standing and history before every consumer', async () => {
  const read = await readRatingStandings(store(['actor-a']), {
    ladder: open,
    seasonId: season.id,
    now: at,
    viewerActorId: 'judge',
  });
  assert({
    given: 'a judge reading a debater assigned in another active Round',
    should:
      'publish only the masked identity/context with no raw rating or history to any surface',
    actual: {
      raw: JSON.stringify(read).includes('1888.125'),
      summaries: read?.summaries.length,
      postings: read?.postings.length,
      entry: read?.entriesBySeason[season.id]?.[0]?.rating,
      blinded: read?.blindedUsernames,
    },
    expected: {
      raw: false,
      summaries: 0,
      postings: 0,
      entry: 0,
      blinded: ['ada'],
    },
  });
});

test('a ladder reads only its own division’s seasons', async () => {
  const read = await readRatingStandings(store(), {
    ladder: { style: 'freestyle', division: 'youth' },
    seasonId: season.id,
    now: at,
  });
  assert({
    given: 'only an Open season, read for the Youth ladder',
    should: 'find no season for it',
    actual: read,
    expected: null,
  });
});
