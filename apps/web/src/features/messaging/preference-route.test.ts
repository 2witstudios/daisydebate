import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMessagingPreferenceHandler } from './preference-route';
setupRitewayBun();
const channelId = 'c'.repeat(24),
  actorId = 'a'.repeat(24),
  userId = 'u'.repeat(24);
const origin = 'https://daisy.example';
const choices = {
  following: false,
  hidden: true,
  notificationLevel: 'none' as const,
};
function fixture() {
  const calls: unknown[] = [];
  let refused = false;
  const handler = createMessagingPreferenceHandler({
    boundary: {
      logger: silentLogger,
      origin: () => origin,
      identify: async () => {
        calls.push('identity');
        return {
          state: 'member',
          principal: { kind: 'user', userId, actorId },
          username: 'testmember',
        };
      },
    },
    maxBodyBytes: 256,
    consume: async (actor) => {
      calls.push(['limit', actor]);
      if (refused) throw createAppError('RATE_LIMIT');
    },
    store: (principal) => {
      calls.push(principal);
      return {
        read: async (scope) => {
          calls.push(['read', scope]);
          return { state: null, unread: 0 };
        },
        update: async (scope, selections) => {
          calls.push(['update', scope, selections]);
          return { state: { ...choices, readSequence: 7 }, unread: 2 };
        },
        clear: async (scope) => {
          calls.push(['clear', scope]);
          return false;
        },
      };
    },
  });
  const request = (body?: unknown, source = origin) =>
    new Request(
      `${origin}/preferences`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { origin: source, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
  return {
    handler,
    calls,
    request,
    refuse: () => {
      refused = true;
    },
  };
}
test('preferences HTTP dispatches only validated own scope and preserves absence/progress/clear results', async () => {
  const { handler, calls, request } = fixture();
  const scope = { version: 1, channelId };
  const results = [];
  for (const operation of ['read', 'update', 'clear'] as const) {
    const response = await handler(
      request(
        operation === 'read'
          ? undefined
          : { ...scope, ...(operation === 'update' ? choices : {}) },
      ),
      operation,
      channelId,
    );
    results.push([response.status, await response.json()]);
  }
  assert({
    given: 'three current own preference operations',
    should:
      'project exact validated results and bind persistence to identified actor',
    actual: [
      results,
      calls.flatMap((call) =>
        Array.isArray(call) &&
        ['read', 'update', 'clear'].includes(String(call[0]))
          ? [call[1]]
          : [],
      ),
    ],
    expected: [
      [
        [200, { ...scope, state: null, unread: 0 }],
        [200, { ...scope, state: { ...choices, readSequence: 7 }, unread: 2 }],
        [200, { ...scope, cleared: false }],
      ],
      Array(3).fill({ channelId, userId, actorId }),
    ],
  });
});
test('preference boundary refuses cross origin, unexpected query and invalid commands without protected writes', async () => {
  const { handler, calls, request, refuse } = fixture();
  const statuses = [];
  statuses.push(
    (await handler(request({}, 'https://foreign.example'), 'update')).status,
  );
  statuses.push(
    (
      await handler(
        new Request(`${origin}/preferences?following=true`),
        'read',
        channelId,
      )
    ).status,
  );
  statuses.push(
    (
      await handler(
        request({ version: 1, channelId, ...choices, extra: true }),
        'update',
      )
    ).status,
  );
  refuse();
  statuses.push(
    (await handler(request({ version: 1, channelId }), 'clear')).status,
  );
  assert({
    given:
      'foreign request, query injection, unknown body field and denied limiter',
    should: 'refuse before protected preference persistence',
    actual: [
      statuses,
      calls.some(
        (call) =>
          Array.isArray(call) &&
          ['read', 'update', 'clear'].includes(String(call[0])),
      ),
    ],
    expected: [[403, 400, 400, 429], false],
  });
});
