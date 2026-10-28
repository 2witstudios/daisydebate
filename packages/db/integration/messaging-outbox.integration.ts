import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { buildChannelTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { appendOutboxEvent } from '../src/outbox';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the channel topic stores no outbox row: channel content is observed (ADR 0089)', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const channelId = createId();
  const topic = buildChannelTopic(channelId);
  try {
    let refused = false;
    try {
      await database.transaction((tx) =>
        appendOutboxEvent(tx, {
          topic,
          kind: 'channel.changed',
          version: 1,
          // The retired doorbell, now outside the payload contract.
          payload: {
            kind: 'channel.changed',
            channelId,
            changeVersion: 1,
          } as never,
        }),
      );
    } catch {
      // The payload contract no longer has the kind, so the append refuses
      // before any insert.
      refused = true;
    }
    const rows = await client.unsafe(
      'select count(*)::int as count from outbox where topic = $1',
      [topic],
    );
    assert({
      given: 'an append of the retired channel doorbell',
      should: 'refuse it before insert and persist nothing',
      actual: { refused, rows: rows[0]?.count },
      expected: { refused: true, rows: 0 },
    });
  } finally {
    await client.unsafe('delete from outbox where topic = $1', [topic]);
    await client.close();
  }
});
