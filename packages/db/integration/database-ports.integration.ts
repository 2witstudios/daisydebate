import { SQL } from 'bun';
import { expect } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('database health and outbox ports use the native pool', async () => {
  const client = new SQL(url, { max: 1 });
  const events: unknown[] = [];
  const database = createDatabase({
    url,
    client,
    nextActorId: createId,
    eventSink: (event, fields) =>
      events.push({ event, operation: fields.operation }),
  });
  const notifications: unknown[] = [];
  try {
    const health = await database.health();
    const listening = await database.checkListen();
    const subscription = await database.listenOutbox({
      onNotify: (position) => notifications.push(position),
      onListen: () => notifications.push('listening'),
    });
    await subscription.unlisten();
    const channels = await client`select pg_listening_channels()`;
    const high = await database.readOutboxHighWaterMark();
    const afterHigh = await database.drainOutbox(
      high ?? { txid: '0', seq: 0n },
      10,
    );
    assert({
      given:
        'a native PostgreSQL pool, an unlistened subscription and a tail drain',
      should:
        'report liveness and the subscription handshake, then unlisten and drain nothing past the tail',
      actual: [health, listening, [...channels], notifications, afterHigh],
      expected: [true, true, [], ['listening'], []],
    });
    await client.close();
    await expect(database.checkListen()).rejects.toThrow(/closed/i);
    await expect(
      database.drainOutbox({ txid: '0', seq: 0n }, 10),
    ).rejects.toThrow('Failed query');
    assert({
      given: 'the closed native pool after its successful round trip',
      should:
        'report both failed operations without exposing connection details',
      actual: events,
      expected: [
        { event: 'db.query.failed', operation: 'checkListen' },
        { event: 'db.query.failed', operation: 'drainOutbox' },
      ],
    });
  } finally {
    await database.close();
    await client.close();
  }
});
