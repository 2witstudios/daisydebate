import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { createWorkloadExecutor } from './workload-admission';

setupRitewayBun();

const failWith = (errno: string) => async () => {
  // The driver's PostgreSQL error, wrapped once as Drizzle wraps it.
  throw Object.assign(new Error('Failed query'), {
    cause: Object.assign(new Error('postgres'), { errno }),
  });
};
const outcome = async (errno: string) =>
  createWorkloadExecutor({ control: 1 })
    .run('control', failWith(errno))
    .then(
      () => 'resolved',
      (error: unknown) => (isAppError(error) ? error.code : 'raw'),
    );

test('database overload surfaces as retryable INFRASTRUCTURE; other failures pass through', async () => {
  assert({
    given:
      'lock_timeout (55P03), statement_timeout (57014), idle (25P03) and transaction (25P04) timeouts, and a constraint violation',
    should:
      'refuse the four overload states as INFRASTRUCTURE and leave the violation unchanged',
    actual: await Promise.all(
      ['55P03', '57014', '25P03', '25P04', '23505'].map(outcome),
    ),
    expected: [
      'INFRASTRUCTURE',
      'INFRASTRUCTURE',
      'INFRASTRUCTURE',
      'INFRASTRUCTURE',
      'raw',
    ],
  });
});
