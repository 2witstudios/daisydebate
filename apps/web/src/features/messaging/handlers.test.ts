import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMessagingHandlers } from './handlers';
setupRitewayBun();
test('messaging HTTP refuses cross-origin requests before principal or protected operations', async () => {
  const calls: string[] = [];
  const handlers = createMessagingHandlers({
    logger: silentLogger,
    origin: () => 'https://daisy.example',
    maxBodyBytes: 1024,
    bounds: { messageUnits: 100, pageItems: 10 },
    identify: async () => {
      calls.push('principal');
      throw new Error('Must not identify');
    },
    edit: async () => {
      throw new Error('Must not edit');
    },
    remove: async () => {
      throw new Error('Must not remove');
    },
    send: async () => {
      calls.push('send');
      throw new Error('Must not send');
    },
    search: async () => {
      throw new Error('Must not search');
    },
    history: async () => {
      calls.push('history');
      throw new Error('Must not read');
    },
    changes: async () => {
      throw new Error('Must not read');
    },
    markRead: async () => {
      throw new Error('Must not mark');
    },
  });
  const response = await handlers.send(
    new Request('https://daisy.example/api/messaging/messages', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  );
  assert({
    given: 'a foreign-origin mutation',
    should: 'refuse before session or protected reads',
    actual: { status: response.status, calls },
    expected: { status: 403, calls: [] },
  });
});

test('authorized history exposes configured transport bounds without inventing a browser page limit', async () => {
  const handlers = authorizedHandlers();
  const response = await handlers.history(
    new Request(
      'https://daisy.example/api/messaging/channels/example/messages',
    ),
    'c'.repeat(24),
  );
  assert({
    given: 'authorized history without a client-supplied limit',
    should:
      'use exactly the configured page size and expose the configured text bound',
    actual: {
      limit: (await response.json()).limit,
      textBound: response.headers.get('x-messaging-message-units'),
    },
    expected: { limit: 10, textBound: '100' },
  });
});

test('search HTTP preserves literal text and rejects ambiguous query parameters', async () => {
  const handlers = authorizedHandlers();
  for (const [query, status] of [
    ['query=%25_literal', 200],
    ['query=one&query=two', 400],
    ['query=one&actorId=foreign', 400],
  ] as const) {
    const response = await handlers.search(
      new Request(`https://daisy.example/api/messaging/search?${query}`),
      'c'.repeat(24),
    );
    assert({
      given: query,
      should: 'preserve a unique query and reject ambiguous authority input',
      actual: response.status,
      expected: status,
    });
    if (status === 200)
      assert({
        given: 'SQL wildcard characters',
        should: 'remain literal request data',
        actual: (await response.json()).query,
        expected: '%_literal',
      });
  }
});

function authorizedHandlers() {
  const echo = async (input: unknown) => input;
  const operations = {
    send: echo,
    edit: echo,
    remove: echo,
    history: echo,
    search: echo,
    changes: echo,
    markRead: echo,
  };
  return createMessagingHandlers({
    ...operations,
    logger: silentLogger,
    origin: () => 'https://daisy.example',
    maxBodyBytes: 1024,
    bounds: { messageUnits: 100, pageItems: 10 },
    identify: async () => ({
      state: 'member',
      username: 'ada',
      principal: {
        kind: 'user',
        userId: 'u'.repeat(24),
        actorId: 'a'.repeat(24),
      },
    }),
  });
}
