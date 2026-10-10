import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createMessagingStore } from '../src/messaging';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('scoped history orders sequence independently from change version and bounds monotonic reads', async () => {
  const client = new SQL(databaseUrl),
    database = drizzle({ client });
  const f = await createMessagingTestFixture(client);
  const messages = [createId(), createId(), createId()];
  try {
    await client.unsafe(
      'update messaging_channels set message_sequence=3,change_version=5 where id=$1',
      [f.channelId],
    );
    for (let i = 0; i < messages.length; i++)
      await client.unsafe(
        'insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,$4,$5,$6,$7)',
        [
          messages[i],
          f.channelId,
          f.actorId,
          i + 1,
          i === 0 ? 5 : i + 1,
          `Message ${i + 1}`,
          f.now,
        ],
      );
    const store = createMessagingStore({ database, authorize: async () => {} });
    const run = <T>(
      work: (
        frame: Parameters<Parameters<typeof store.withChannel<T>>[1]>[0],
      ) => Promise<T>,
    ) =>
      store.withChannel(
        { channelId: f.channelId, userId: f.userId, actorId: f.actorId },
        async (frame) => {
          await frame.authorize();
          return work(frame);
        },
      );
    const page = await run((frame) => frame.history({ limit: 2 }));
    const next = await run((frame) =>
      frame.history({ limit: 2, before: page.nextBefore!.sequence }),
    );
    const changes = await run((frame) => frame.changes({ limit: 2, after: 0 }));
    assert({
      given: 'three messages and an edit of sequence one at version five',
      should:
        'page descending immutable sequences and reconnect by independent change versions',
      actual: {
        page: page.messages.map((row) => row.sequence),
        next: next.messages.map((row) => row.sequence),
        changes: changes.messages.map((row) => row.changeVersion),
      },
      expected: { page: [3, 2], next: [1], changes: [2, 3] },
    });
    const first = await run((frame) => frame.markRead(3));
    const retry = await run((frame) => frame.markRead(1));
    assert({
      given: 'a later read cursor followed by a stale retry',
      should: 'keep the durable cursor monotonic without content mutations',
      actual: { first, retry },
      expected: { first: 3, retry: 3 },
    });
    await assertRejects({
      given: 'a cursor beyond committed channel history',
      should: 'reject without changing actor read state',
      actual: () => run((frame) => frame.markRead(4)),
      code: 'VALIDATION',
    });
  } finally {
    await f.cleanup();
    await client.close();
  }
});
