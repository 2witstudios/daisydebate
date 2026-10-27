import { assert, setupRitewayBun, test } from 'riteway/bun';
import { instrumented, refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { createRecordingLogger } from '../../server/test-loggers.test-support';
import { reportAuthFailure } from './failure-report';

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
