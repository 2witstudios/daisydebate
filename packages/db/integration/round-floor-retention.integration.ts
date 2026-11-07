import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  databaseUrl,
  prepared,
  send,
  cleanupFloor,
} from './round-floor.test-support';
import { roundFloorRetention } from '../src/messaging/round-floor-retention';
setupRitewayBun();
test('bounded retention drains receipts and reply leaves without resetting counters', async () =>
  withFixture(databaseUrl, async (f) => {
    const { store, scope, db } = await prepared(f);
    try {
      const a = await send(store, scope),
        b = await send(store, scope),
        c = await send(store, scope);
      await f.sql`update messaging_messages set reply_to_message_id=${a.id} where id=${b.id}`;
      await f.sql`update messaging_messages set reply_to_message_id=${b.id} where id=${c.id}`;
      await store.readFloor(scope, (x) => x.markRead(3));
      await f.sql`update rounds set status='abandoned',completed_at='2026-01-01',version=version+1 where id=${scope.roundId}`;
      const retention = roundFloorRetention(db),
        batch = { before: '2026-01-01T00:00:00.000Z', limit: 1 };
      const blocked = await retention.purgeExpiredRoundFloorMessages(batch);
      const receipts = [
        await retention.purgeExpiredRoundFloorReceipts(batch),
        await retention.purgeExpiredRoundFloorReceipts(batch),
        await retention.purgeExpiredRoundFloorReceipts(batch),
        await retention.purgeExpiredRoundFloorReceipts(batch),
      ];
      const messages = [
        await retention.purgeExpiredRoundFloorMessages(batch),
        await retention.purgeExpiredRoundFloorMessages(batch),
        await retention.purgeExpiredRoundFloorMessages(batch),
        await retention.purgeExpiredRoundFloorMessages(batch),
      ];
      const states = await retention.purgeExpiredRoundFloorReadStates(batch);
      const [counter] =
        await f.sql`select message_sequence::int as sequence from messaging_channel_streams where channel_id=${scope.channelId}`;
      assert({
        given:
          'an expired floor reply chain with retry receipts and read state',
        should:
          'drain at most the requested rows per call and retain the durable sequence',
        actual: {
          blocked,
          receipts,
          messages,
          states,
          sequence: counter.sequence,
        },
        expected: {
          blocked: 0,
          receipts: [1, 1, 1, 0],
          messages: [1, 1, 1, 0],
          states: 1,
          sequence: 3,
        },
      });
    } finally {
      await cleanupFloor(f, scope.roundId);
    }
  }));
