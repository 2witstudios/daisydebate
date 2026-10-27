import { assert, setupRitewayBun, test } from 'riteway/bun';
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
      origin: () => origin,
      identify: async () => member as never,
    },
    set: async (_principal, hidden) => {
      calls.push(hidden);
      return { hidden };
    },
  });
  const set = await handlers.set(post({ version: 1, hidden: true }));
  const named = await handlers.set(
    post({ version: 1, hidden: true, username: 'ada' }),
  );
  assert({
    given: 'a valid choice, then one that names another member',
    should: 'set the first and refuse the second before any change',
    actual: [set.status, await set.json(), named.status, calls],
    expected: [200, { version: 1, hidden: true }, 400, [true]],
  });
});
