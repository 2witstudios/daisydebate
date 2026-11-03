import { assert, setupRitewayBun, test } from 'riteway/bun';
import { peopleListSchema } from './people-list';
setupRitewayBun();

test('a row on the list always shows at least one rating', () => {
  const member = {
    username: 'ada',
    status: 'online',
    relation: 'none',
    wins: 1,
    losses: 0,
  };
  const page = (ratings: readonly unknown[]) => ({
    version: 1,
    people: [{ ...member, ratings }],
    nextCursor: null,
    counts: { everyone: 1, friends: 0, online: 1 },
    self: 'online',
  });
  assert({
    given: 'a row with Freestyle, and a row with no ratings',
    should: 'accept the first and refuse the second',
    actual: [
      peopleListSchema.safeParse(
        page([
          {
            ladder: 'freestyle',
            rating: null,
            provisional: false,
            hidden: false,
          },
        ]),
      ).success,
      peopleListSchema.safeParse(page([])).success,
    ],
    expected: [true, false],
  });
});
