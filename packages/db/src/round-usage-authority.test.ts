import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  requireAdmissionTarget,
  requireSponsor,
} from './round-usage-authority';

setupRitewayBun();

const host = 'hostaaaaa1b2c3d4e5f6g7h8';
const member = { member: true, erased: false };
const round = (overrides: Record<string, unknown> = {}) => ({
  createdByActorId: host,
  competitionType: 'casual',
  status: 'opening',
  ...overrides,
});
test('admission targets are cuid2 actor and Round ids', async () => {
  assert({
    given: 'cuid2 ids',
    should: 'admit the target',
    actual: requireAdmissionTarget({ actorId: host, roundId: host }),
    expected: undefined,
  });
  await assertRejects({
    given: 'a non-cuid2 Round id',
    should: 'refuse it as invalid input',
    actual: () => requireAdmissionTarget({ actorId: host, roundId: '1' }),
    code: 'VALIDATION',
  });
});

test('only the host of an unranked unfinished Round sponsors casual AI usage', async () => {
  assert({
    given: 'a member host of scheduled and active casual Rounds',
    should: 'admit the sponsor',
    actual: [
      requireSponsor(member, round(), host),
      requireSponsor(member, round({ status: 'active' }), host),
    ],
    expected: [undefined, undefined],
  });
  for (const [label, account, candidate, code] of [
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
  ] as const)
    await assertRejects({
      given: `admission with ${label}`,
      should: 'refuse the sponsor',
      actual: () => requireSponsor(account, candidate, host),
      code,
    });
});
