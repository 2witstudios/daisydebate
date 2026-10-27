import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRecordingLogger } from '../../server/test-loggers.test-support';
import { handleOperation } from '../../server/http';
import { createAfterResponse } from './after-response';

setupRitewayBun();

for (const refused of [true, false]) {
  test(`deferred ${refused ? 'admission refusal' : 'query failure'} preserves the already-produced response`, async () => {
    const { logger, recorded } = createRecordingLogger();
    const work = createAfterResponse(logger);
    const release = Promise.withResolvers<void>();
    const error = refused ? refuseCapacity() : createAppError('INFRASTRUCTURE');
    const response = await handleOperation(
      logger,
      new Request('http://localhost/auth'),
      'auth.request',
      () =>
        work.around(async () => {
          work.defer(async () => {
            await release.promise;
            throw new Error('driver wrapper', { cause: error });
          });
          return new Response(null, { status: 200 });
        }),
    );
    release.resolve();
    await work.settled();
    assert({
      given: `an already-answered auth request whose deferred work ${refused ? 'was refused unrun' : 'failed for another reason'}`,
      should:
        'retain the actual 200 completion, settle the backlog, and report crashes only for genuine failures',
      actual: {
        status: response.status,
        completed: recorded
          .filter(({ event }) => event === 'http.request.completed')
          .map(({ fields }) => fields.status),
        failures: recorded.filter(
          ({ event }) => event === 'http.request.failed',
        ).length,
        crashes: recorded.filter(({ event }) => event === 'request.unhandled')
          .length,
        pending: work.pending(),
      },
      expected: {
        status: 200,
        completed: [200],
        failures: 0,
        crashes: refused ? 0 : 1,
        pending: 0,
      },
    });
  });
}
