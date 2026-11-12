import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { idSchema } from '@daisy/protocol';
import { z } from 'zod';
import { silentLogger } from '../../../server/test-loggers.test-support';
import { createContextChatHandlers } from './handlers';

setupRitewayBun();
const roundId = 'r'.repeat(24);
const channelId = 'c'.repeat(24);
const origin = 'https://daisy.example';
const principal = {
  kind: 'user' as const,
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
};
const fixture = () => {
  const calls: string[] = [];
  const echo = async (input: unknown) => {
    calls.push('operation');
    return input;
  };
  return {
    calls,
    handlers: createContextChatHandlers({
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => {
        calls.push('identity');
        return { state: 'member' as const, username: 'ada', principal };
      },
      maxBodyBytes: 1024,
      bounds: { messageUnits: 100, pageItems: 10 },
      operationName: (kind) => `messaging.floor.${kind}`,
      open: z.strictObject({ version: z.literal(1), roundId: idSchema }),
      ownerOf: (open) => open.roundId,
      operations: {
        open: echo,
        discover: echo,
        history: echo,
        send: echo,
        edit: echo,
        remove: echo,
        markRead: echo,
        report: echo,
      },
    }),
  };
};

test('chat mutations refuse a foreign origin before identity or operations', async () => {
  const f = fixture();
  const response = await f.handlers.open(
    new Request(`${origin}/api/rounds/${roundId}/floor`, {
      method: 'POST',
      headers: { origin: 'https://foreign.example' },
      body: '{}',
    }),
    roundId,
  );
  assert({
    given: 'a foreign-origin chat open',
    should: 'refuse before identity or protected work',
    actual: [response.status, f.calls],
    expected: [403, []],
  });
});

test('chat open binds the route Round rather than a submitted different Round', async () => {
  const f = fixture();
  const response = await f.handlers.open(
    new Request(`${origin}/api/rounds/${roundId}/floor`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, roundId: 'f'.repeat(24) }),
    }),
    roundId,
  );
  assert({
    given: 'a mismatched Round in the bound request',
    should: 'refuse without operating on either Round',
    actual: [response.status, f.calls],
    expected: [400, ['identity']],
  });
});

test('chat history refuses ambiguous and foreign authority query fields', async () => {
  for (const query of [
    `channelId=${channelId}&actorId=${principal.actorId}`,
    `channelId=${channelId}&channelId=${channelId}`,
    `channelId=${channelId}&before=not-a-sequence`,
  ]) {
    const f = fixture();
    const response = await f.handlers.history(
      new Request(`${origin}/api/rounds/${roundId}/floor/messages?${query}`),
      roundId,
    );
    assert({
      given: query,
      should: 'refuse malformed scope before protected work',
      actual: [response.status, f.calls],
      expected: [400, ['identity']],
    });
  }
});

test('chat history carries configured bounds and a bound cursor', async () => {
  const f = fixture();
  const response = await f.handlers.history(
    new Request(
      `${origin}/api/rounds/${roundId}/floor/messages?channelId=${channelId}&before=12`,
    ),
    roundId,
  );
  assert({
    given: 'an authorized chat page request',
    should: 'bind the Round and cursor and report configured message bounds',
    actual: [
      response.status,
      await response.json(),
      response.headers.get('x-messaging-message-units'),
    ],
    expected: [
      200,
      {
        ownerId: roundId,
        value: {
          version: 1,
          channelId,
          limit: 10,
          before: { channelId, sequence: 12 },
        },
      },
      '100',
    ],
  });
});
