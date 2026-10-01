import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listTournaments } from './list-tournaments';
import { defaultQuery } from './query';

setupRitewayBun();

const ids = (query: Partial<typeof defaultQuery>, signedIn = true) =>
  listTournaments({ ...defaultQuery, ...query }, signedIn).rows.map(
    (row) => row.tournament.id,
  );

describe('listTournaments', () => {
  test('the default index', () => {
    const listing = listTournaments(defaultQuery, true);
    assert({
      given: 'the default query, signed in',
      should: 'list the open tab, count every tab and feature Autumn Open',
      actual: [
        listing.rows.map((row) => row.tournament.id),
        listing.counts,
        listing.featured?.tournament.id,
        listing.featured?.entry?.kind,
        listing.viewer?.handle,
      ],
      expected: [
        [
          'autumn-open',
          'weeknight-sprint',
          'lantern-round-robin',
          'bronze-cup',
        ],
        { open: 4, upcoming: 5, live: 2, past: 2 },
        'autumn-open',
        'registered',
        'debater-a',
      ],
    });
  });

  test('your tournaments put the live one first', () => {
    assert({
      given: 'the signed-in viewer',
      should: 'list Harvest Cup first, then the registered and waitlisted',
      actual: listTournaments(defaultQuery, true).yours.map(
        (item) => item.tournament.id,
      ),
      expected: ['harvest-cup', 'autumn-open', 'novice-cup', 'hollow-cup'],
    });
  });

  test('signed out there is no viewer, entry or your-tournaments', () => {
    const listing = listTournaments(defaultQuery, false);
    assert({
      given: 'an anonymous visitor',
      should: 'see the same list with no viewer state',
      actual: [
        listing.viewer,
        listing.yours,
        listing.featured?.entry,
        listing.rows.length,
      ],
      expected: [null, [], null, 4],
    });
  });

  test('tabs and filters', () => {
    assert({
      given: 'the live tab, a round-robin filter and a search with no match',
      should: 'narrow the list',
      actual: [
        ids({ tab: 'live' }),
        ids({ tab: 'past', structure: 'round-robin' }),
        ids({ q: 'zzz' }),
        ids({ tab: 'upcoming', rules: 'custom' }),
      ],
      expected: [
        ['harvest-cup', 'club-championship'],
        ['midsummer-round-robin'],
        [],
        ['novice-cup'],
      ],
    });
  });
});
