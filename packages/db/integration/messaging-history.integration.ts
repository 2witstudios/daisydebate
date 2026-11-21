import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { createMessagingStore } from '../src/messaging';
import { channelReadFrame } from '../src/messaging/read-frame';
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
      'update messaging_channel_streams set message_sequence=3,change_version=8 where channel_id=$1',
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
    const searched = await run((frame) =>
      frame.history({ limit: 2, before: 4, query: 'MESSAGE' }),
    );
    const next = await run((frame) =>
      frame.history({ limit: 2, before: page.nextBefore!.sequence }),
    );
    const changes = await run((frame) => frame.changes({ limit: 2, after: 0 }));
    const final = await run((frame) => frame.changes({ limit: 2, after: 3 }));
    assert({
      given: 'three messages and an edit of sequence one at version five',
      should:
        'page descending immutable sequences and reconnect by independent change versions',
      actual: {
        page: page.messages.map((row) => row.sequence),
        next: next.messages.map((row) => row.sequence),
        changes: changes.messages.map((row) => row.changeVersion),
        cursors: [searched.nextBefore, changes.nextAfter, final.nextAfter],
        search: searched.messages.map(({ sequence }) => sequence),
      },
      expected: {
        page: [3, 2],
        next: [1],
        changes: [2, 3],
        cursors: [
          { channelId: f.channelId, sequence: 2 },
          { channelId: f.channelId, changeVersion: 3 },
          { channelId: f.channelId, changeVersion: 8 },
        ],
        search: [3, 2],
      },
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

test('invalid history inputs and current authority refusal issue no content SQL', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, channelId } = fixture;
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const scope = { actorId, channelId };
  const counters = { channelId, messageSequence: 3, changeVersion: 8 };
  const valid = channelReadFrame(database, scope, counters, async () => {});
  const denied = channelReadFrame(database, scope, counters, async () => {
    throw createAppError('AUTHORIZATION');
  });
  try {
    for (const attempt of [
      () => denied.history({ limit: 2 }),
      () => denied.changes({ limit: 2, after: 0 }),
      () => denied.markRead(1),
    ])
      await assertRejects({
        given: 'revoked reading authority',
        should: 'refuse each protected operation',
        actual: attempt,
        code: 'AUTHORIZATION',
      });
    for (const attempt of [
      () => valid.history({ limit: 0 }),
      () => valid.history({ limit: 65536 }),
      () => valid.history({ limit: 1, before: -1 }),
      () => valid.history({ limit: 1, query: ' ' }),
      () => valid.changes({ limit: 1, after: 0.5 }),
      () => valid.markRead(4),
    ])
      await assertRejects({
        given: 'an invalid page, search, or future cursor',
        should: 'refuse each invalid input',
        actual: attempt,
        code: 'VALIDATION',
      });
    assert({
      given: 'all refused read and mark operations',
      should: 'neither query nor write content',
      actual: statements,
      expected: [],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
