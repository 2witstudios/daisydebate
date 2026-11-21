import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTypingStore } from '../src/messaging/typing-store';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('typing fences the real cast, refuses the small bound, and publishes only a thin hint', async () => {
  const client = new SQL(url);
  const fixture = await createMessagingTestFixture(client);
  const scope = {
    actorId: fixture.actorId,
    userId: fixture.userId,
    channelId: fixture.channelId,
  };
  const statements: { query: string; params: unknown[] }[] = [];
  const db = drizzle({
    client,
    logger: { logQuery: (query, params) => statements.push({ query, params }) },
  });
  const store = createMessagingTypingStore(db);
  try {
    let visited = false;
    await assertRejects({
      given: 'two real actors with one actor of budget',
      should: 'refuse before projection or notifying',
      actual: () =>
        store(scope, 1, async () => {
          visited = true;
        }),
      code: 'INFRASTRUCTURE',
    });
    const refused = [visited, statements.splice(0).length];
    const value = await store(scope, 2, async (frame) => {
      await frame.notify();
      return [
        frame.fact.channelId,
        frame.accounts.length,
        frame.channels.map((row) => row.fact?.channelId),
      ];
    });
    const has = (needle: string) =>
      statements.some(({ query }) => query.includes(needle));
    const notification = statements.find(({ query }) =>
      query.includes('pg_notify'),
    );
    assert({
      given: 'a refused typing budget then a real shared cast frame',
      should:
        'use only the shared account and channel fences and publish a channel-only commit hint with no outbox row',
      actual: [
        refused,
        value,
        has('daisy_authorization_read_accounts_v2('),
        has('daisy_messaging_channel_read_fence('),
        has('daisy_authorization_accounts_v2('),
        has('daisy_messaging_channel_fence('),
        has('insert into "outbox"'),
        notification?.params,
      ],
      expected: [
        [false, 4],
        [scope.channelId, 2, [scope.channelId, scope.channelId]],
        true,
        true,
        false,
        false,
        false,
        [
          JSON.stringify({
            v: 1,
            type: 'typing_changed',
            topic: `channel:${scope.channelId}`,
          }),
        ],
      ],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
