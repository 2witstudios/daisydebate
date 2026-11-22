import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { drizzle } from 'drizzle-orm/bun-sql';
import { withFixture } from './constraint-helpers';
import { spectatorChatModeration } from '../src/messaging/spectator-chat';
import { roundFloorModeration } from '../src/messaging/round-floor-moderation';
import { roomCommunityModeration } from '../src/messaging/room-community-moderation';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

for (const [kind, policy, owner] of [
  ['round_spectator', 'round.spectator', spectatorChatModeration],
  ['round_floor', 'round.floor', roundFloorModeration],
  ['room_community', 'room.community', roomCommunityModeration],
] as const)
  test(`${kind} removal preserves native creation precision and its first removal stamp`, () =>
    withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      const actorId = await f.participant(roundId, 'affirmative');
      const roomId = await f.room(actorId, await f.format());
      const channelId = createId();
      const db = drizzle({ client: f.sql });
      try {
        await f.sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,round_id,room_id)
          values(${channelId},${kind},${policy},1,'active',${kind === 'room_community' ? null : roundId},${kind === 'room_community' ? roomId : null})`;
        await f.sql`insert into messaging_channel_streams(channel_id,message_sequence,change_version) values(${channelId},2,2)`;
        for (const [index, stamp] of [
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.002Z',
        ].entries()) {
          const messageId = createId();
          await f.sql`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at)
            values(${messageId},${channelId},${actorId},${index + 1},2,'Original message','2026-01-01T00:00:00.000999Z'::timestamptz)`;
          const expectedStamp =
            index === 0 ? '2026-01-01T00:00:00.000999Z' : stamp;
          const applied = await db.transaction((tx) =>
            owner.remove(tx, { messageId, now: new Date(stamp) }),
          );
          const [first] =
            await f.sql`select text, removed_at=${expectedStamp}::timestamptz as exact from messaging_messages where id=${messageId}`;
          const replay = await db.transaction((tx) =>
            owner.remove(tx, {
              messageId,
              now: new Date('2026-01-02T00:00:00Z'),
            }),
          );
          const [retained] =
            await f.sql`select removed_at=${expectedStamp}::timestamptz as exact from messaging_messages where id=${messageId}`;
          assert({
            given: `${kind} native microsecond creation and ${index === 0 ? 'a millisecond-rounded' : 'a later'} removal time`,
            should:
              'remove without violating native time ordering and retain the original stamp on replay',
            actual: { applied, first, replay, retained },
            expected: {
              applied: 'applied',
              first: { text: null, exact: true },
              replay: 'unchanged',
              retained: { exact: true },
            },
          });
        }
      } finally {
        await f.sql`delete from messaging_channels where id=${channelId}`;
      }
    }));
