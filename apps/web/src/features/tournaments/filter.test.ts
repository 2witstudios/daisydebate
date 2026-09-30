import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { filterTournaments, tabCounts } from './filter';
import { defaultQuery } from './query';
import { tournament } from './tournament.test-support';

setupRitewayBun();

const items = [
  tournament({ id: 'a', name: 'Autumn Open' }),
  tournament({ id: 'b', name: 'Lantern', structure: 'round-robin' }),
  tournament({ id: 'c', name: 'Novice Cup', rules: 'custom', entered: 16 }),
  tournament({ id: 'd', name: 'Harvest', lifecycle: 'in-progress' }),
  tournament({ id: 'e', name: 'Summer', lifecycle: 'completed' }),
];

const ids = (query: Partial<typeof defaultQuery>) =>
  filterTournaments(items, { ...defaultQuery, ...query }).map(
    (item) => item.id,
  );

describe('filterTournaments', () => {
  test('the tab decides the pool', () => {
    assert({
      given: 'each tab',
      should: 'list that tab only',
      actual: [
        ids({}),
        ids({ tab: 'upcoming' }),
        ids({ tab: 'live' }),
        ids({ tab: 'past' }),
      ],
      expected: [['a', 'b'], ['c'], ['d'], ['e']],
    });
  });

  test('structure, rules and search narrow within the tab', () => {
    assert({
      given: 'a structure, a rules filter, and searches by name and by rules',
      should: 'keep only the matches, ignoring case',
      actual: [
        ids({ structure: 'round-robin' }),
        ids({ tab: 'upcoming', rules: 'custom' }),
        ids({ rules: 'custom' }),
        ids({ q: 'AUTUMN' }),
        ids({ q: 'round robin' }),
        ids({ q: 'zzz' }),
      ],
      expected: [['b'], ['c'], [], ['a'], ['b'], []],
    });
  });
});

describe('tabCounts', () => {
  test('counts ignore filters', () => {
    assert({
      given: 'five tournaments across the tabs',
      should: 'count each tab in full',
      actual: tabCounts(items),
      expected: { open: 2, upcoming: 1, live: 1, past: 1 },
    });
  });
});
