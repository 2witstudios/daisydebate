import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingPreferenceStore } from '../src/messaging/preference-store';
import { createMessagingTestFixture } from '../src/testing';
import type { Tx } from '../src/tx';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('preference updates require their own authority and read back the current state', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, userId, channelId } = fixture;
  const scope = { actorId, userId, channelId };
  const operations: unknown[] = [];
  let updateTx: Tx | undefined;
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const desired = {
    following: true,
    hidden: false,
    notificationLevel: 'all' as const,
  };
  const store = createMessagingPreferenceStore(database, {
    read: async (tx, input, frame) => {
      operations.push(['read', input, frame.fact.channelId, tx === updateTx]);
    },
    update: async (tx, input, frame) => {
      updateTx = tx;
      operations.push(['update', input, frame.fact.channelId]);
    },
    clear: async () => {
      throw new Error('Unexpected clear');
    },
  });
  try {
    await client`update messaging_channel_streams set message_sequence=4, change_version=4 where channel_id=${channelId}`;
    await client`insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence)
      values(${channelId},${actorId},false,false,'none',4)`;
    const changed = await store.update(scope, desired);
    assert({
      given:
        'a preference update on a real channel that already has read progress',
      should:
        'authorize update and read separately in the same frame and retain the read sequence',
      actual: [changed, operations],
      expected: [
        { state: { ...desired, readSequence: 4 }, unread: 0 },
        [
          ['update', scope, channelId],
          ['read', scope, channelId, true],
        ],
      ],
    });
    statements.length = 0;
    operations.length = 0;
    const rejected = createMessagingPreferenceStore(database, {
      read: async () => {
        operations.push('read');
      },
      update: async () => {
        operations.push('update');
        throw createAppError('AUTHORIZATION');
      },
      clear: async () => {
        throw new Error('Unexpected clear');
      },
    });
    await assertRejects({
      given: 'a reader that cannot update current preferences',
      should: 'refuse an attempted change',
      actual: () => rejected.update(scope, { ...desired, hidden: true }),
      code: 'AUTHORIZATION',
    });
    const [{ hidden }] = await client`select hidden from messaging_actor_states
      where channel_id=${channelId} and actor_id=${actorId}`;
    assert({
      given: 'the refusal with the real account, pair and channel fences',
      should: 'settle before reading or writing actor preferences',
      actual: [
        operations,
        statements.some((query) => query.includes('messaging_actor_states')),
        hidden,
      ],
      expected: [['update'], false, false],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
