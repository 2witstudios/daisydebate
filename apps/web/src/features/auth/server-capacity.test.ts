import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { BetterAuthOptions } from 'better-auth';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { capacityRefusal } from '@daisy/db/testing';
import { assertRejects } from '@daisy/errors/testing';
import type { Logger } from '@daisy/logger';
import {
  authTestEnv,
  composeAuthServer,
  memoryTables,
} from './auth-server.test-support';

setupRitewayBun();

test('a request whose database lane refuses it is an explicit capacity refusal, not an unhandled failure', async () => {
  const refusal = await capacityRefusal();
  const underlying = memoryAdapter(memoryTables());
  // Every database step is refused unrun, as a saturated lane refuses it.
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
  const database: BetterAuthOptions['database'] = (options) =>
    new Proxy(underlying(options), {
      get: (target, property) =>
        steps.has(String(property))
          ? async () => {
              throw refusal;
            }
          : Reflect.get(target, property),
    });
  const logged: string[] = [];
  const logger: Logger = {
    log: (event) => void logged.push(event),
    child: () => logger,
  };
  const server = composeAuthServer({ database, logger });
  await assertRejects({
    given: 'a magic-link request whose database lane refuses it',
    should: 'reject with INFRASTRUCTURE, which the route answers 503',
    actual: () =>
      server.instance.handler(
        new Request(
          `${authTestEnv.PUBLIC_APP_URL}/api/auth/sign-in/magic-link`,
          {
            method: 'POST',
            headers: {
              origin: authTestEnv.PUBLIC_APP_URL,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ email: 'player@daisy.example.com' }),
          },
        ),
      ),
    code: 'INFRASTRUCTURE',
  });
  await server.settled();
  assert({
    given: 'the refused request',
    should: 'log no unhandled failure: the lane already logged the refusal',
    actual: logged.filter((event) => event === 'request.unhandled'),
    expected: [],
  });
});
