import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture, type Fixture } from './constraint-helpers';
import {
  readMessagingChannelFact,
  readMessagingChannelFacts,
} from '../src/messaging/social';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const roomChannel = (roomId: string) => ({
  id: createId(),
  kind: 'room_community',
  policy_key: 'room.community',
  policy_revision: 1,
  lifecycle: 'active',
  room_id: roomId,
});
const room = async (f: Fixture) => {
  const host = await f.actor();
  return { host, roomId: await f.room(host, await f.format()) };
};

describe('Room chat channel identity (RCHAT-2)', () => {
  test('one channel per Room', async () => {
    await withFixture(databaseUrl, async (f) => {
      const first = await room(f);
      const second = await room(f);
      try {
        await f.insert('messaging_channels', roomChannel(first.roomId));
        assert({
          given: 'a Room that already has its chat channel',
          should:
            'refuse a second one by the Room/kind key and admit another Room’s',
          actual: [
            await f.rejectedBy('messaging_channels', roomChannel(first.roomId)),
            await f.rejectedBy(
              'messaging_channels',
              roomChannel(second.roomId),
            ),
          ],
          expected: ['messaging_channels_room_kind_unique', null],
        });
      } finally {
        await f.sql`delete from messaging_channels where room_id in (${first.roomId},${second.roomId})`;
      }
    });
  });

  test('each kind has exactly its owner and its policy', async () => {
    await withFixture(databaseUrl, async (f) => {
      const { roomId } = await room(f);
      const roundId = await f.round();
      const chat = roomChannel(roomId);
      const floor = {
        id: createId(),
        kind: 'round_floor',
        policy_key: 'round.floor',
        policy_revision: 1,
        lifecycle: 'active',
        round_id: roundId,
      };
      const social = {
        id: createId(),
        kind: 'dm',
        policy_key: 'social.dm',
        policy_revision: 1,
        lifecycle: 'active',
      };
      try {
        assert({
          given:
            'a Room channel with no Room, with a Round, with a Round as well, under another policy; a Round channel and a social channel that name a Room; and a Room that does not exist',
          should: 'refuse each by the constraint that owns that boundary',
          actual: {
            noRoom: await f.rejectedBy('messaging_channels', {
              ...chat,
              room_id: null,
            }),
            roundInstead: await f.rejectedBy('messaging_channels', {
              ...chat,
              room_id: null,
              round_id: roundId,
            }),
            roundAsWell: await f.rejectedBy('messaging_channels', {
              ...chat,
              round_id: roundId,
            }),
            floorPolicy: await f.rejectedBy('messaging_channels', {
              ...chat,
              policy_key: 'round.floor',
            }),
            socialPolicy: await f.rejectedBy('messaging_channels', {
              ...chat,
              policy_key: 'social.private_group',
            }),
            floorWithRoom: await f.rejectedBy('messaging_channels', {
              ...floor,
              room_id: roomId,
            }),
            floorInRoomOnly: await f.rejectedBy('messaging_channels', {
              ...floor,
              round_id: null,
              room_id: roomId,
            }),
            socialWithRoom: await f.rejectedBy('messaging_channels', {
              ...social,
              room_id: roomId,
            }),
            missingRoom: await f.rejectedBy('messaging_channels', {
              ...chat,
              room_id: createId(),
            }),
            unknownKind: await f.rejectedBy('messaging_channels', {
              ...chat,
              kind: 'room_lobby',
            }),
          },
          expected: {
            noRoom: 'messaging_channels_room',
            roundInstead: 'messaging_channels_room',
            roundAsWell: 'messaging_channels_round',
            floorPolicy: 'messaging_channels_policy',
            socialPolicy: 'messaging_channels_policy',
            floorWithRoom: 'messaging_channels_room',
            floorInRoomOnly: 'messaging_channels_room',
            socialWithRoom: 'messaging_channels_room',
            missingRoom: 'messaging_channels_room_id_rooms_id_fkey',
            unknownKind: 'messaging_channels_kind',
          },
        });
      } finally {
        await f.sql`delete from messaging_channels where id in (${chat.id},${floor.id},${social.id})`;
      }
    });
  });

  test('a Room’s chat goes with its Room', async () => {
    await withFixture(databaseUrl, async (f) => {
      const { roomId } = await room(f);
      const chat = roomChannel(roomId);
      await f.insert('messaging_channels', chat);
      await f.sql`delete from rooms where id=${roomId}`;
      assert({
        given: 'a Room deleted while it has a chat channel',
        should: 'delete the channel with it',
        actual: await f.count('messaging_channels', 'id', chat.id),
        expected: 0,
      });
    });
  });

  for (const mode of ['single', 'batch'] as const) {
    test(`Room chat has no social authority (${mode})`, async () => {
      await withFixture(databaseUrl, async (f) => {
        const { roomId, host } = await room(f);
        const chat = roomChannel(roomId);
        try {
          await f.insert('messaging_channels', chat);
          const db = drizzle({ client: f.sql });
          const binding = { channelId: chat.id, actorId: host };
          assert({
            given: 'a Room chat channel and the host of its Room',
            should: 'remain absent to social-channel authority readers',
            actual:
              mode === 'single'
                ? await readMessagingChannelFact(db, chat.id, host)
                : await readMessagingChannelFacts(db, [binding]),
            expected: mode === 'single' ? null : [null],
          });
        } finally {
          await f.sql`delete from messaging_channels where id=${chat.id}`;
        }
      });
    });
  }
});
