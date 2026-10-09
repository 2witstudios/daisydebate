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
