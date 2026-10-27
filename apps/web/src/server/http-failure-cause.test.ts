import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { handleOperation } from './http';
import { createLogger } from '@daisy/logger';

setupRitewayBun();

const failWith = async (error: unknown) => {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'http-failure-proof',
    destination: {
      write: (line) => {
        lines.push(line);
      },
    },
  });
  const response = await handleOperation(
    logger,
    new Request('http://localhost/api/foundation/proof'),
    'test.operation',
    () => Promise.reject(error),
  );
  return {
    status: response.status,
    body: await response.text(),
    cause: (JSON.parse(lines.at(-1) ?? '{}') as { cause?: unknown }).cause,
  };
};

test('a transaction recovery failure logs its recovery state and inner code (ISSUE-618, ISSUE-630)', async () => {
  const failed = await failWith(
    createAppError(
      'INFRASTRUCTURE',
      'Transcript transaction recovery pending',
      {
        recovery: 'pending',
        cause: createAppError(
          'INVARIANT',
          'Check-in marker closure was not durably confirmed',
        ),
      },
    ),
  );
  assert({
    given: 'a 503 whose transaction recovery could not be confirmed',
    should:
      'log the recovery state and the inner error code, never in the body',
    actual: {
      status: failed.status,
      cause: failed.cause,
      leaked: failed.body.includes('recovery'),
    },
    expected: {
      status: 503,
      cause: 'recovery_pending.INVARIANT',
      leaked: false,
    },
  });
});

test('a rolled-back transaction failure logs its recovery state alone', async () => {
  const failed = await failWith(
    createAppError('INFRASTRUCTURE', 'Transcript transaction budget exceeded', {
      recovery: 'rolled-back',
    }),
  );
  assert({
    given: 'a 503 after a confirmed rollback with no inner error',
    should: 'log only the recovery state',
    actual: failed.cause,
    expected: 'recovery_rolled-back',
  });
});

test('a failure without transaction recovery logs no cause', async () => {
  const failed = await failWith(createAppError('INFRASTRUCTURE'));
  assert({
    given: 'an infrastructure failure that carries no recovery state',
    should: 'leave the cause field out',
    actual: failed.cause,
    expected: undefined,
  });
});
