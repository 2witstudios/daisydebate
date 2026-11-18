import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isUniqueViolation, isUniqueViolationOf } from './unique-violation';

setupRitewayBun();

/** Bun SQL's server error, as drizzle wraps it. */
const wrapped = (errno: string, constraint: string) =>
  Object.assign(new Error('Failed query'), {
    cause: Object.assign(new Error('duplicate key'), {
      code: 'ERR_POSTGRES_SERVER_ERROR',
      errno,
      constraint,
    }),
  });

describe('isUniqueViolationOf', () => {
  test('the named key', () => {
    assert({
      given: "a wrapped unique violation of action history's primary key",
      should: 'name that key and no other',
      actual: [
        isUniqueViolationOf(
          wrapped('23505', 'action_history_pkey'),
          'action_history_pkey',
        ),
        isUniqueViolationOf(
          wrapped('23505', 'grants_live_unique'),
          'action_history_pkey',
        ),
        isUniqueViolation(wrapped('23505', 'grants_live_unique')),
      ],
      expected: [true, false, true],
    });
  });
  test('another failure', () => {
    assert({
      given: 'a foreign-key violation on the same constraint name',
      should: 'not be a unique violation',
      actual: isUniqueViolationOf(
        wrapped('23503', 'action_history_pkey'),
        'action_history_pkey',
      ),
      expected: false,
    });
  });
});
