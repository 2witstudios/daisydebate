import { assert, setupRitewayBun, test } from 'riteway/bun';
import { instrumented, refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { createRecordingLogger } from '../../server/test-loggers.test-support';
import { betterAuthLogger, reportAuthFailure } from './failure-report';

setupRitewayBun();

/** Runs a rejection through the real database boundary, its sink into `logger`. */
const throughDatabase = async (
  logger: ReturnType<typeof createRecordingLogger>['logger'],
  error: unknown,
) =>
  instrumented(
    (event, fields, message) =>
      logger.log(event as 'db.capacity.refused', fields, message),
    'lookup',
    async () => {
      throw error;
    },
  ).catch((rejection: unknown) => rejection);

const events = (
  recorded: ReturnType<typeof createRecordingLogger>['recorded'],
) => recorded.map(({ event }) => event);

test('a refusal the database boundary reported is logged once in all', async () => {
  const { logger, recorded } = createRecordingLogger();
  const rejection = await throughDatabase(logger, refuseCapacity());
  reportAuthFailure(
    logger,
    new Error('driver wrapper', { cause: rejection }),
    'better-auth',
    'Authentication request failed',
  );
  assert({
    given:
      'a capacity refusal that passed through instrumented, then reached auth wrapped',
    should: 'leave exactly one db.capacity.refused and no crash report',
    actual: events(recorded),
    expected: ['db.capacity.refused'],
  });
});

test('a refusal nobody reported is logged as a refusal, not a crash', () => {
  const { logger, recorded } = createRecordingLogger();
  reportAuthFailure(
    logger,
    refuseCapacity(),
    'auth.after-response',
    'Authentication work after the answer failed',
  );
  assert({
    given: 'a capacity refusal that never passed through the database boundary',
    should: 'log db.capacity.refused once and no request.unhandled',
    actual: events(recorded),
    expected: ['db.capacity.refused'],
  });
});

test('any other failure is a crash report', () => {
  const { logger, recorded } = createRecordingLogger();
  reportAuthFailure(
    logger,
    createAppError('INFRASTRUCTURE'),
    'better-auth',
    'Authentication request failed',
  );
  assert({
    given: 'an infrastructure failure',
    should: 'log request.unhandled',
    actual: events(recorded),
    expected: ['request.unhandled'],
  });
});

test('a refusal Better Auth logs and swallows is reported once, and not again if rethrown', async () => {
  const { logger, recorded } = createRecordingLogger();
  const refusal = refuseCapacity();
  betterAuthLogger(logger).log(
    'error',
    'Failed to read session from database',
    refusal,
  );
  const swallowed = events(recorded);
  reportAuthFailure(
    logger,
    new Error('rethrown', { cause: refusal }),
    'better-auth',
    'Authentication request failed',
  );
  assert({
    given:
      'a capacity refusal Better Auth catches and logs, then the same refusal reaching the handler',
    should:
      'report it when Better Auth logs it, and leave exactly one db.capacity.refused and no crash report in all',
    actual: { swallowed, total: events(recorded) },
    expected: {
      swallowed: ['db.capacity.refused'],
      total: ['db.capacity.refused'],
    },
  });
});

test('Better Auth failures that are not refusals report severity only', () => {
  const { logger, recorded } = createRecordingLogger();
  const auth = betterAuthLogger(logger);
  auth.log('info', 'routine');
  auth.log('warn', 'select * from session where token = $1', new Error('x'));
  assert({
    given: 'an info line and a warning carrying driver detail',
    should:
      'drop the info line and report the warning as request.unhandled without its message',
    actual: recorded,
    expected: [
      {
        event: 'request.unhandled',
        fields: { source: 'better-auth', sourceLevel: 'warn' },
        message: 'Authentication library reported a failure',
      },
    ],
  });
});
