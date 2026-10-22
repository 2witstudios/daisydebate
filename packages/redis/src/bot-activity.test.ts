import { assert, setupRitewayBun, test } from 'riteway/bun';
import { botActivityFixture } from '@daisy/protocol/bot-activity-testing';
import { createBotActivityOperations } from './bot-activity';
import type { RedisTransport } from './transport';
setupRitewayBun();
test('activity transport refuses persistent or unreadable capability before any PCM write', async () => {
  for (const reply of [
    { appendonly: 'yes', save: '' },
    { appendonly: 'no', save: '900 1' },
    {},
    null,
  ]) {
    let writes = 0;
    const client: RedisTransport = {
      connect: async () => {},
      ping: async () => 'PONG',
      get: async () => null,
      getdel: async () => null,
      del: async () => 0,
      close: () => {},
      send: async (command) => {
        if (command === 'CONFIG') return reply;
        writes++;
        return 'OK';
      },
    };
    const activity = createBotActivityOperations({
      client,
      namespace: 'unit-activity',
      reportFailure: () => {},
    });
    const refusal = await activity
      .writeBotActivity(
        botActivityFixture(
          'abcdefghijklmnopqrstuvwx',
          'mnopqrstuvwxabcdefghijkl',
        ),
      )
      .then(
        () => null,
        (error) => error.message,
      );
    assert({
      given: 'persistent or unreadable Redis metadata at the adapter boundary',
      should: 'refuse transport with zero PCM writes',
      actual: [refusal, writes],
      expected: ['Memory-only Redis capability required', 0],
    });
  }
});
