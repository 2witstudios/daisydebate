import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { BetterAuthOptions } from 'better-auth';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { createRecordingLogger } from '../../server/test-loggers.test-support';
import { handleOperation } from '../../server/http';
import {
  authTestEnv,
  composeAuthServer,
  memoryTables,
} from './auth-server.test-support';

setupRitewayBun();

for (const refused of [true, false]) {
  test(`auth ${refused ? 'capacity refusal' : 'genuine database failure'} preserves truthful request telemetry`, async () => {
    const error = refused ? refuseCapacity() : createAppError('INFRASTRUCTURE');
    const underlying = memoryAdapter(memoryTables());
    const steps = new Set([
      'create',
      'findOne',
      'findMany',
      'count',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
    ]);
    // Real Better Auth composition, with only the unavailable database edge replaced.
    const database: BetterAuthOptions['database'] = (options) =>
      new Proxy(underlying(options), {
        get: (target, property) =>
          steps.has(String(property))
            ? async () => {
                throw new Error('driver wrapper', { cause: error });
              }
            : Reflect.get(target, property),
      });
    const { logger, recorded } = createRecordingLogger();
    const server = composeAuthServer({ database, logger });
    const request = new Request(
      `${authTestEnv.PUBLIC_APP_URL}/api/auth/sign-in/magic-link`,
      {
        method: 'POST',
        headers: {
          origin: authTestEnv.PUBLIC_APP_URL,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'player@daisy.example.com' }),
      },
    );
    const response = await handleOperation(
      logger,
      request,
      'auth.request',
      () => server.instance.handler(request),
    );
    await server.settled();
    const body = await response.json();
    assert({
      given: `a magic-link request encountering ${refused ? 'known unrun admission backpressure' : 'an unrelated infrastructure failure'}`,
      should:
        'answer public 503, retain failed-request status, and suppress crash reporting only for admission refusal',
      actual: {
        status: response.status,
        code: body.error.code,
        safe: !JSON.stringify(body).includes('driver wrapper'),
        failedStatus: recorded
          .filter(({ event }) => event === 'http.request.failed')
          .map(({ fields }) => (fields as Record<string, unknown>).status),
        crashReported: recorded.some(
          ({ event }) => event === 'request.unhandled',
        ),
      },
      expected: {
        status: 503,
        code: 'INFRASTRUCTURE',
        safe: true,
        failedStatus: [503],
        crashReported: !refused,
      },
    });
  });
}
