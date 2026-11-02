import { assert, setupRitewayBun, test } from 'riteway/bun';
import { onlineRosterSchema, presenceSettingSchema } from './presence-setting';
setupRitewayBun();

test('the chosen status command', () => {
  const parse = (value: unknown) =>
    presenceSettingSchema.safeParse(value).success;
  assert({
    given: 'a choice, a derived status, and a choice naming another member',
    should: 'accept only the choice',
    actual: [
      parse({ version: 1, status: 'busy' }),
      parse({ version: 1, status: 'round' }),
      parse({ version: 1, status: 'busy', username: 'ada' }),
    ],
    expected: [true, false, false],
  });
});

test('a roster row always shows at least one rating', () => {
  const member = {
    username: 'ada',
    status: 'online',
    relation: 'none',
    wins: 1,
    losses: 0,
  };
  const roster = (ratings: readonly unknown[]) => ({
    version: 1,
    members: [{ ...member, ratings }],
    nextCursor: null,
    counts: { everyone: 1, friends: 0 },
    self: 'online',
  });
  assert({
    given: 'a row with Freestyle, and a row with no ratings',
    should: 'accept the first and refuse the second',
    actual: [
      onlineRosterSchema.safeParse(
        roster([{ ladder: 'freestyle', rating: null, provisional: false }]),
      ).success,
      onlineRosterSchema.safeParse(roster([])).success,
    ],
    expected: [true, false],
  });
});
