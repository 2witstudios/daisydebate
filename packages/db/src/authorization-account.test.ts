import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorizationAccountFact,
  type AuthorizationAccountRow,
} from './authorization-account';
setupRitewayBun();
const row: AuthorizationAccountRow = {
  userId: 'u',
  actorId: 'a',
  actorKind: 'human',
  actorUserId: 'u',
  username: 'ada',
  emailVerified: true,
  deletedAt: null,
  revision: 1,
};
describe('durable account authorization projection', () => {
  test('member derives from bound durable account facts', () => {
    assert({
      given: 'a verified account and its human actor',
      should: 'produce bound member authority',
      actual: authorizationAccountFact(row),
      expected: {
        userId: 'u',
        actorId: 'a',
        member: true,
        erased: false,
        revision: 1,
      },
    });
  });
  test('missing and invalid durable facts do not grant membership', () => {
    assert({
      given:
        'unknown account, foreign actor, bot, unverified, provisional and erased rows',
      should: 'fail closed',
      actual: [
        null,
        { ...row, actorUserId: 'other' },
        { ...row, actorKind: 'bot' },
        { ...row, emailVerified: false },
        { ...row, username: null },
        { ...row, deletedAt: '2026-10-09T00:00:00.000Z' },
      ].map((value) => authorizationAccountFact(value)?.member ?? false),
      expected: Array(6).fill(false),
    });
  });
});
