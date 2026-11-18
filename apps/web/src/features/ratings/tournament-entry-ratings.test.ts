import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { tournamentEntryRatings } from './tournament-entry-ratings';
setupRitewayBun();
const snapshot = {
  takenAt: '2027-01-01T00:00:00.000Z',
  calculation: 'glicko2-v1',
  ladders: [
    {
      ladderId: 'ladder',
      actors: [
        { actorId: 'a', rating: 1600, deviation: 90 },
        { actorId: 'b', rating: 1601, deviation: 91 },
      ],
    },
  ],
  events: [{ eventId: 'event', ladderId: 'ladder' }],
};
describe('tournamentEntryRatings', () => {
  test('uses frozen member ratings and canonical team rounding', () => {
    assert({
      given: 'two rated teammates in the frozen tournament input',
      should: 'use the engine team mean and half-even rounding',
      actual: tournamentEntryRatings(
        snapshot,
        'event',
        [{ id: 'team' }],
        [
          { entryId: 'team', actorId: 'a' },
          { entryId: 'team', actorId: 'b' },
        ],
      )?.entries,
      expected: [
        { entry: 'team', status: 'rated', rating: 1600, deviation: 90 },
      ],
    });
  });
  test('keeps missing members unrated and never follows a later event setting', () => {
    assert({
      given: 'one absent member and an event added after the freeze',
      should: 'invent neither a rating nor a new ladder selection',
      actual: [
        tournamentEntryRatings(
          snapshot,
          'event',
          [{ id: 'team' }],
          [
            { entryId: 'team', actorId: 'a' },
            { entryId: 'team', actorId: 'new' },
          ],
        )?.entries,
        tournamentEntryRatings(snapshot, 'new-event', [], []),
        tournamentEntryRatings(null, 'event', [], []),
      ],
      expected: [[{ entry: 'team', status: 'unrated' }], null, null],
    });
  });
});
