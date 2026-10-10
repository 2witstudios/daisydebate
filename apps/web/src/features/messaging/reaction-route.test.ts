import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createMessagingReactionHandler,
  createMessagingReactionReader,
  readReactionQuery,
} from './reaction-route';
import { silentLogger } from '../../server/test-loggers.test-support';
setupRitewayBun();
test('mounted reaction boundary preserves authenticated scope and refuses foreign origin before command dispatch', async () => {
  const origin = 'https://daisy.example';
  const received: unknown[] = [];
  const principal = {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
  };
  const handler = createMessagingReactionHandler({
    boundary: {
      logger: silentLogger,
      origin: () => origin,
      identify: async () => ({
        state: 'member',
        username: 'member',
        principal,
      }),
    },
    maxBodyBytes: 256,
    change: async (value, actor) => {
      received.push([value, actor]);
      return { accepted: true };
    },
  });
  const command = {
    version: 1,
    channelId: 'c'.repeat(24),
    messageId: 'm'.repeat(24),
    requestId: 'r'.repeat(24),
    reaction: '👍',
    active: true,
  };
  const request = (source: string) =>
    new Request(`${origin}/reactions`, {
      method: 'POST',
      headers: { origin: source, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
  const accepted = await handler(request(origin));
  const refused = await handler(request('https://foreign.example'));
  assert({
    given: 'same-origin and cross-origin reaction intents',
    should:
      'dispatch only the signed-in current actor and return the operation projection',
    actual: [accepted.status, await accepted.json(), refused.status, received],
    expected: [200, { accepted: true }, 403, [[command, principal]]],
  });
});

test('reaction summary scope refuses additional or repeated selector fields', async () => {
  for (const query of ['messageId=m&actorId=a', 'messageId=m&messageId=n', ''])
    await assertRejects({
      given: 'noncanonical reaction summary query',
      should:
        'reject selection ambiguity instead of ignoring authority-shaped fields',
      actual: async () =>
        readReactionQuery(
          new Request(`https://daisy.example/reactions?${query}`),
          'c'.repeat(24),
        ),
      code: 'VALIDATION',
    });
});

test('reaction GET carries only validated message scope and server-configured endpoint', async () => {
  const scopes: unknown[] = [];
  const channelId = 'c'.repeat(24),
    messageId = 'm'.repeat(24);
  const boundary = {
    logger: silentLogger,
    origin: () => 'https://daisy.example',
    identify: async () => ({
      state: 'member' as const,
      username: 'member',
      principal: {
        kind: 'user' as const,
        userId: 'u'.repeat(24),
        actorId: 'a'.repeat(24),
      },
    }),
  };
  const reader = createMessagingReactionReader({
    boundary,
    websocketEndpoint: 'wss://daisy.example/ws',
    read: async (scope) => {
      scopes.push(scope);
      return { accepted: true };
    },
  });
  const response = await reader(
    new Request(`https://daisy.example/reactions?messageId=${messageId}`),
    channelId,
  );
  const invalid = await reader(
    new Request(
      `https://daisy.example/reactions?messageId=${messageId}&actorId=a`,
    ),
    channelId,
  );
  assert({
    given: 'canonical read selection and a forged actor query',
    should:
      'bind only route channel/message and expose only the injected endpoint after current identity',
    actual: [
      response.status,
      response.headers.get('x-realtime-socket-url'),
      await response.json(),
      invalid.status,
      scopes,
    ],
    expected: [
      200,
      'wss://daisy.example/ws',
      { accepted: true },
      400,
      [{ version: 1, channelId, messageId }],
    ],
  });
});
