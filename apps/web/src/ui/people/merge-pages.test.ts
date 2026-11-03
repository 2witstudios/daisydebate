import type { PeopleList, Person } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mergePages } from './merge-pages';

setupRitewayBun();

const person = (username: string, status: Person['status']): Person => ({
  username,
  status,
  relation: 'none',
  ratings: [
    { ladder: 'freestyle', rating: null, provisional: false, hidden: false },
  ],
  wins: 0,
  losses: 0,
});

const page = (
  people: readonly Person[],
  nextCursor: string | null,
): PeopleList => ({
  version: 1,
  people: [...people],
  nextCursor,
  counts: { everyone: 3, friends: 0, online: 1 },
  self: 'online',
});

test('someone who went offline between two page reads', () => {
  const merged = mergePages(
    page([person('ada', 'online'), person('bea', 'online')], 'first'),
    page([person('ada', 'offline'), person('cy', 'offline')], null),
  );
  assert({
    given: 'a person served on both pages, online then offline',
    should: 'list them once, in place, with the later status and cursor',
    actual: {
      rows: merged.people.map((row) => [row.username, row.status]),
      nextCursor: merged.nextCursor,
    },
    expected: {
      rows: [
        ['ada', 'offline'],
        ['bea', 'online'],
        ['cy', 'offline'],
      ],
      nextCursor: null,
    },
  });
});
