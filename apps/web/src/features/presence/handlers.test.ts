import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../../server/test-loggers.test-support';
import { member, origin } from '../../server/member-handler.test-support';
import { createPresenceHandlers } from './handlers';

setupRitewayBun();

const post = (body: unknown) =>
  new Request(`${origin}/api/presence`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the presence route sets only the caller’s own choice', async () => {
  const calls: unknown[] = [];
  const handlers = createPresenceHandlers({
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => member as never,
    },
    websocketEndpoint: null,
    online: async () => {
      throw new Error('Unexpected online read');
    },
    set: async (_principal, status) => {
      calls.push(status);
      return { status };
    },
    read: async () => ({ status: 'online' }),
  });
  const set = await handlers.set(post({ version: 1, status: 'busy' }));
  const named = await handlers.set(
    post({ version: 1, status: 'busy', username: 'ada' }),
  );
  assert({
    given: 'a valid choice, then one that names another member',
    should: 'set the first and refuse the second before any change',
    actual: [set.status, await set.json(), named.status, calls],
    expected: [200, { version: 1, status: 'busy' }, 400, ['busy']],
  });
});

test('the presence route reads only the caller’s own choice', async () => {
  const handlers = createPresenceHandlers({
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => member as never,
    },
    websocketEndpoint: null,
    online: async () => {
      throw new Error('Unexpected online read');
    },
    set: async () => ({ status: 'online' }),
    read: async (principal) => ({
      status:
        principal.kind === 'user' && principal.actorId === 'a'.repeat(24)
          ? 'offline'
          : 'online',
    }),
  });
  const read = await handlers.read(
    new Request(`${origin}/api/presence`, { headers: { origin } }),
  );
  assert({
    given: 'a same-origin read by a member appearing offline',
    should: 'answer their own setting in the published contract',
    actual: [read.status, await read.json()],
    expected: [200, { version: 1, status: 'offline' }],
  });
});
