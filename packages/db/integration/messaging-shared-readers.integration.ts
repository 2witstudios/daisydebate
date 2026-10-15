import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createMessagingStore } from '../src/messaging/store';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
import { withFixture, sqlStateOf } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('channel readers share authority fences and never block the stream append lock', async () => {
  await withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql);
    const store = createMessagingStore({
      database: drizzle({ client: f.sql }),
      authorize: async () => {},
    });
    const scope = {
      channelId: fixture.channelId,
      actorId: fixture.actorId,
      userId: fixture.userId,
    };
    const { promise: parked, resolve: park } = Promise.withResolvers<void>();
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();
    try {
      const held = store.withReadChannel(scope, async (frame) => {
        park();
        await released;
        return frame.counters;
      });
      await parked;
      const peer = await store.withReadChannel(
        {
          ...scope,
          actorId: fixture.otherActorId,
          userId: fixture.otherUserId,
        },
        async (frame) => (await frame.history({ limit: 5 })).messages.length,
      );
      const append = await sqlStateOf(() =>
        f.sql.begin(async (tx) => {
          await tx`select change_version from messaging_channel_streams where channel_id=${fixture.channelId} for update nowait`;
          await tx`update messaging_channel_streams set change_version=change_version+1 where channel_id=${fixture.channelId}`;
        }),
      );
      const accountWriter = await sqlStateOf(() =>
        f.sql.begin(
          (tx) =>
            tx`select id from users where id=${fixture.userId} for update nowait`,
        ),
      );
      const authorityWriter = await sqlStateOf(() =>
        f.sql.begin(
          (tx) =>
            tx`select id from messaging_channels where id=${fixture.channelId} for update nowait`,
        ),
      );
      release();
      assert({
        given: 'one reader parked inside its shared fences on an accepted DM',
        should:
          'let a second reader and a stream append proceed while refusing exclusive account and authority writers',
        actual: {
          peer,
          append,
          accountWriter,
          authorityWriter,
          held: await held,
        },
        expected: {
          peer: 0,
          append: 'accepted',
          accountWriter: '55P03',
          authorityWriter: '55P03',
          held: {
            channelId: fixture.channelId,
            messageSequence: 0,
            changeVersion: 0,
          },
        },
      });
    } finally {
      release();
      await fixture.cleanup();
    }
  });
});
