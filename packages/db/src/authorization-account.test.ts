import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorizationAccountFact,
  type AuthorizationAccountRow,
} from './authorization-account';
setupRitewayBun();
const row: AuthorizationAccountRow = {
  userId: 'a'.repeat(24),
  actorId: 'b'.repeat(24),
  member: true,
  erased: false,
  revision: 1,
};
describe('durable account authorization projection', () => {
  test('member projects validated minimal producer facts', () => {
    assert({
      given: 'the current canonical account function projection',
      should: 'preserve only validated account binding facts',
      actual: authorizationAccountFact(row),
      expected: {
        userId: row.userId,
        actorId: row.actorId,
        member: true,
        erased: false,
        revision: 1,
      },
    });
  });
  test('missing and invalid durable facts do not grant membership', () => {
    assert({
      given:
        'missing account, malformed identifiers, invalid member state and invalid revisions',
      should: 'fail closed',
      actual: [
        null,
        { ...row, userId: 'foreign' },
        { ...row, actorId: 'invalid' },
        { ...row, member: false },
        { ...row, actorId: null },
        { ...row, erased: true },
        { ...row, revision: 0 },
      ].map((value) => authorizationAccountFact(value)?.member ?? false),
      expected: Array(7).fill(false),
    });
  });
});
