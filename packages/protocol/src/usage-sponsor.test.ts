import { assert, setupRitewayBun, test } from 'riteway/bun';
import { casualUsageSponsorRefusal } from './usage-sponsor';

setupRitewayBun();

const host = 'hostaaaaa1b2c3d4e5f6g7h8';
const member = { member: true, erased: false };
const round = (
  overrides: Partial<
    NonNullable<Parameters<typeof casualUsageSponsorRefusal>[1]>
  > = {},
) => ({
  createdByActorId: host,
  competitionType: 'casual',
  status: 'opening' as const,
  ...overrides,
});

test('only the host of an unranked unfinished Round sponsors casual AI usage', () => {
  assert({
    given: 'a member host of scheduled and active casual Rounds',
    should: 'admit the sponsor',
    actual: [
      casualUsageSponsorRefusal(member, round(), host),
      casualUsageSponsorRefusal(member, round({ status: 'active' }), host),
    ],
    expected: [null, null],
  });
  const refused = [
    ['a missing Round', member, undefined, 'AUTHORIZATION'],
    [
      'another host',
      member,
      round({ createdByActorId: 'other' }),
      'AUTHORIZATION',
    ],
    ['no account', null, round(), 'AUTHORIZATION'],
    [
      'a non-member',
      { member: false, erased: false },
      round(),
      'AUTHORIZATION',
    ],
    [
      'an erased account',
      { member: true, erased: true },
      round(),
      'AUTHORIZATION',
    ],
    [
      'a ranked Round',
      member,
      round({ competitionType: 'ranked' }),
      'AUTHORIZATION',
    ],
    ['a completed Round', member, round({ status: 'completed' }), 'CONFLICT'],
  ] as const;
  assert({
    given:
      'a missing Round, another host, no, non-member or erased account, a ranked or completed Round',
    should: 'refuse the sponsor with its code',
    actual: refused.map(([, account, candidate]) =>
      casualUsageSponsorRefusal(account, candidate, host),
    ),
    expected: refused.map(([, , , code]) => code),
  });
});
