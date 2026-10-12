import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MIGRATOR_SESSION, RUNTIME_SESSION } from './session-bounds';

setupRitewayBun();

test('the migrator gives up on a lock before the app statements queued behind it do', () => {
  assert({
    given: 'the release migrator and runtime pool session bounds',
    should:
      'bound the migrator lock wait below the runtime lock_timeout, and bound its statements',
    actual: {
      migratorYieldsFirst:
        MIGRATOR_SESSION.lock_timeout < RUNTIME_SESSION.lock_timeout,
      migratorLockBounded: MIGRATOR_SESSION.lock_timeout > 0,
      migratorStatementBounded: MIGRATOR_SESSION.statement_timeout > 0,
    },
    expected: {
      migratorYieldsFirst: true,
      migratorLockBounded: true,
      migratorStatementBounded: true,
    },
  });
});

test('runtime work is bounded on the server through transaction settlement and idle callbacks', () => {
  assert({
    given: 'runtime session settings',
    should:
      'bound transaction and idle-in-transaction lifetime with explicit READ COMMITTED',
    actual: RUNTIME_SESSION,
    expected: {
      statement_timeout: 800,
      lock_timeout: 200,
      transaction_timeout: 800,
      idle_in_transaction_session_timeout: 400,
      default_transaction_isolation: 'read committed',
    },
  });
});
