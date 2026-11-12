import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  databaseUrl,
  prepared,
  send,
  cleanupRoomChat,
  endRoom,
} from './room-community.test-support';
import { roomCommunityRetention } from '../src/messaging/room-community-retention';
setupRitewayBun();
const ended = '2026-01-01T00:00:00.000Z';
test('bounded retention drains receipts and reply leaves without resetting counters', async () =>
  withFixture(databaseUrl, async (f) => {
    const { store, scope, db } = await prepared(f);
    try {
      const a = await send(store, scope),
        b = await send(store, scope),
        c = await send(store, scope);
      await f.sql`update messaging_messages set reply_to_message_id=${a.id} where id=${b.id}`;
      await f.sql`update messaging_messages set reply_to_message_id=${b.id} where id=${c.id}`;
      await store.readChat(scope, (x) => x.markRead(3));
      await endRoom(f.sql, scope.roomId, 'started', ended);
      const retention = roomCommunityRetention(db),
        batch = { before: ended, limit: 1 };
      const blocked = await retention.purgeExpiredRoomCommunityMessages(batch);
      const receipts = [
        await retention.purgeExpiredRoomCommunityReceipts(batch),
        await retention.purgeExpiredRoomCommunityReceipts(batch),
        await retention.purgeExpiredRoomCommunityReceipts(batch),
        await retention.purgeExpiredRoomCommunityReceipts(batch),
      ];
      const messages = [
        await retention.purgeExpiredRoomCommunityMessages(batch),
        await retention.purgeExpiredRoomCommunityMessages(batch),
        await retention.purgeExpiredRoomCommunityMessages(batch),
        await retention.purgeExpiredRoomCommunityMessages(batch),
      ];
      const states = await retention.purgeExpiredRoomCommunityReadStates(batch);
      const [counter] =
        await f.sql`select message_sequence::int as sequence from messaging_channel_streams where channel_id=${scope.channelId}`;
      assert({
        given:
          'a reply chain with retry receipts and read state in a Room that ended at the cutoff',
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
      await cleanupRoomChat(f, scope.roomId);
    }
  }));
for (const [name, status, endedAt] of [
  ['an open Room', null, ended],
  ['a Room that ended after the cutoff', 'closed', '2026-01-01T00:00:00.001Z'],
] as const)
  test(`retention leaves ${name} alone`, async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope, db } = await prepared(f);
      try {
        await send(store, scope);
        await store.readChat(scope, (x) => x.markRead(1));
        if (status) await endRoom(f.sql, scope.roomId, status, endedAt);
        else
          await f.sql`update rooms set updated_at=${endedAt}::timestamptz where id=${scope.roomId}`;
        const retention = roomCommunityRetention(db),
          batch = { before: ended, limit: 500 };
        assert({
          given: `${name} with a message, a receipt and read state`,
          should: 'purge nothing',
          actual: [
            await retention.purgeExpiredRoomCommunityReceipts(batch),
            await retention.purgeExpiredRoomCommunityMessages(batch),
            await retention.purgeExpiredRoomCommunityReadStates(batch),
          ],
          expected: [0, 0, 0],
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
