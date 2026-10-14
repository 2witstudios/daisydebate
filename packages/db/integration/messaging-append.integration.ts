import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingAppend } from '../src/messaging/append';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('batch send duplicates allocate once and acknowledge only committed rows', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { channelId, actorId, userId, now } = fixture;
  const requestId = createId();
  const append = createMessagingAppend(drizzle({ client }));
  const attempt = (id: string) => ({
    scope: { channelId, actorId, userId },
    command: {
      version: 1 as const,
      channelId,
      requestId: id,
      text: 'Batch content',
    },
    authorize: async () => {},
    admit: async () => {},
    decide: (state: import('../src/messaging/records').MessagingSendState) => {
      if (state.receipt)
        return { kind: 'replay' as const, message: state.existingMessage! };
      const message = {
        id: createId(),
        channelId,
        authorActorId: actorId,
        sequence: state.counters.messageSequence + 1,
        changeVersion: state.counters.changeVersion + 1,
        text: 'Batch content',
        createdAt: now,
        editedAt: null,
        removedAt: null,
      };
      return {
        kind: 'create' as const,
        message,
        receipt: { messageId: message.id, payloadDigest: 'a'.repeat(64) },
        doorbell: {
          kind: 'channel.changed' as const,
          channelId,
          changeVersion: message.changeVersion,
        },
      };
    },
  });
  try {
    const values = await Promise.all([
      append.send(attempt(requestId)),
      append.send(attempt(requestId)),
      append.send(attempt(createId())),
    ]);
    const [stream] = await client.unsafe(
      'select message_sequence,change_version from messaging_channel_streams where channel_id=$1',
      [channelId],
    );
    assert({
      given: 'three batched commands including a duplicate',
      should: 'return two committed messages and allocate two counters',
      actual: [
        values.map((value) => value.sequence),
        Number(stream.message_sequence),
        Number(stream.change_version),
      ],
      expected: [[1, 1, 2], 2, 2],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
