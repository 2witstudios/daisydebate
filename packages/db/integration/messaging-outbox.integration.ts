import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { buildChannelTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { appendOutboxEvent } from '../src/outbox';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('channel doorbells commit once, refuse foreign identity, and roll back with their transaction', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const channelId = createId();
  const topic = buildChannelTopic(channelId);
  const input = {
    topic,
    kind: 'channel.changed',
    version: 1,
    payload: { kind: 'channel.changed' as const, channelId, changeVersion: 1 },
  };
  try {
    await database.transaction((tx) => appendOutboxEvent(tx, input));
    let refused = false;
    try {
      await database.transaction((tx) =>
        appendOutboxEvent(tx, {
          ...input,
          payload: { ...input.payload, channelId: createId() },
        }),
      );
    } catch (error) {
      refused =
        error instanceof Error && error.message.includes('not storable');
    }
    let rolledBack = false;
    try {
      await database.transaction(async (tx) => {
        await appendOutboxEvent(tx, {
          ...input,
          payload: { ...input.payload, changeVersion: 2 },
        });
        throw new Error('messaging rollback control');
      });
    } catch (error) {
      rolledBack =
        error instanceof Error &&
        error.message === 'messaging rollback control';
    }
    const rows = (await client.unsafe(
      'select kind, payload from outbox where topic = $1 order by seq',
      [topic],
    )) as Array<{ kind: string; payload: unknown }>;
    assert({
      given: 'one accepted append, a foreign channel and a rolled-back append',
      should: 'persist exactly the accepted content-free doorbell',
      actual: {
        refused,
        rolledBack,
        rows: Array.from(rows, (row) => ({
          kind: row.kind,
          payload: row.payload,
        })),
      },
      expected: {
        refused: true,
        rolledBack: true,
        rows: [{ kind: input.kind, payload: input.payload }],
      },
    });
  } finally {
    await client.unsafe('delete from outbox where topic = $1', [topic]);
    await client.close();
  }
});
