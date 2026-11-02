import { assert, setupRitewayBun, test } from 'riteway/bun';
import { databaseFailure } from './database-failure';

setupRitewayBun();

const driver = (fields: object) =>
  Object.assign(new Error('private driver text'), fields);

test('a failed read is named by what the database said, never its text', () => {
  assert({
    given:
      'lock and statement timeouts, wrapped or not, other server and connection errors, and a code bug',
    should: 'give a fixed word for each and null for the code bug',
    actual: [
      databaseFailure(driver({ errno: '55P03' })),
      databaseFailure(
        new Error('query failed', { cause: driver({ errno: '55P03' }) }),
      ),
      databaseFailure(driver({ errno: '57014' })),
      databaseFailure(driver({ errno: '40001' })),
      databaseFailure(driver({ code: 'ERR_POSTGRES_CONNECTION_CLOSED' })),
      databaseFailure(new TypeError('not a function')),
    ],
    expected: [
      'lock_timeout',
      'lock_timeout',
      'statement_timeout',
      'database',
      'database',
      null,
    ],
  });
});
