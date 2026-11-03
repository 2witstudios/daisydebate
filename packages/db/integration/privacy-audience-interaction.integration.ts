import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceReactionPrivacyAdopter } from '../src/audience-reactions';
import { createMessagingPrivacyAdopter } from '../src/messaging/privacy';
import { debaterFollowPrivacyAdopter } from '../src/debater-follows';
import { notificationPrivacyAdopter } from '../src/notifications';
import { watchHistoryPrivacyAdopter } from '../src/watch-history';
import { withFixture } from './constraint-helpers';
import { exportThenErase, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const count = async (
  client: { unsafe: (query: string, values: unknown[]) => Promise<unknown> },
  table: string,
  column: string,
  value: string,
) =>
  (
    (await client.unsafe(
      `select count(*)::int as c from ${table} where ${column} = $1`,
      [value],
    )) as { c: number }[]
  )[0]!.c;

test('export carries the subject’s audience activity, and erasure removes every row of it, both directions', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      const otherUser = await f.user();
      const otherActor = await f.actor(otherUser);
      const reactionId = createId();
      await client.unsafe(
        `insert into audience_reactions (id,round_id,user_id,kind,spaced_at,created_at)
         values ($1,$2,$3,'sharp_point',now(),now())`,
        [reactionId, roundId, userId],
      );
      await client.unsafe(
        `insert into debater_follows (follower_user_id,debater_actor_id) values ($1,$2),($3,$4)`,
        [userId, otherActor, otherUser, actorId],
      );
      await client.unsafe(
        `insert into watch_history (user_id,round_id,watched_at) values ($1,$2,now())`,
        [userId, roundId],
      );
      await client.unsafe(
        `insert into notifications (id,user_id,kind,round_id) values ($1,$2,'recording_ready',$3)`,
        [createId(), userId, roundId],
      );
      // Someone else was told the subject was on air.
      const told = createId();
      await client.unsafe(
        `insert into notifications (id,user_id,kind,round_id,debater_actor_id) values ($1,$2,'followed_debater_live',$3,$4)`,
        [told, otherUser, roundId, actorId],
      );
      await client.unsafe(
        `insert into notification_preferences (user_id,kind,enabled) values ($1,'recording_ready',false)`,
        [userId],
      );
      const exported = await exportThenErase(database, { userId, actorId }, [
        audienceReactionPrivacyAdopter,
        debaterFollowPrivacyAdopter,
        watchHistoryPrivacyAdopter,
        notificationPrivacyAdopter,
      ]);
      assert({
        given: 'one account’s reactions, follows, history and notifications',
        should:
          'export only their own rows, then leave nothing that names them, including another’s row about them',
        actual: {
          exported: [
            exported.audience_reactions?.length,
            exported.debater_follows?.length,
            exported.watch_history?.length,
            exported.notifications?.length,
            exported.notification_preferences?.length,
          ],
          left: [
            await count(client, 'audience_reactions', 'user_id', userId),
            await count(client, 'debater_follows', 'follower_user_id', userId),
            await count(client, 'debater_follows', 'debater_actor_id', actorId),
            await count(client, 'watch_history', 'user_id', userId),
            await count(client, 'notifications', 'user_id', userId),
            await count(client, 'notifications', 'id', told),
            await count(client, 'notification_preferences', 'user_id', userId),
          ],
        },
        expected: {
          exported: [1, 1, 1, 1, 1],
          left: [0, 0, 0, 0, 0, 0, 0],
        },
      });
    });
  });
});

test('erasure scrubs the subject’s spectator chat in place, keeping its place and no words', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      const channelId = createId();
      const messageId = createId();
      try {
        await client.unsafe(
          `insert into messaging_channels (id,kind,policy_key,policy_revision,lifecycle,round_id)
           values ($1,'round_spectator','round.spectator',1,'active',$2)`,
          [channelId, roundId],
        );
        await client.unsafe(
          `insert into messaging_channel_streams (channel_id,message_sequence,change_version) values ($1,1,1)`,
          [channelId],
        );
        await client.unsafe(
          `insert into messaging_messages (id,channel_id,author_actor_id,sequence,change_version,text,created_at)
           values ($1,$2,$3,1,1,'Words to erase',timestamptz '2020-01-01 00:00:00+00')`,
          [messageId, channelId, actorId],
        );
        const exported = await exportThenErase(database, { userId, actorId }, [
          createMessagingPrivacyAdopter(),
        ]);
        const [row] = (await client.unsafe(
          'select text,removed_at is not null as removed from messaging_messages where id=$1',
          [messageId],
        )) as { text: string | null; removed: boolean }[];
        assert({
          given: 'a spectator message by a member who is erased',
          should: 'export it, then keep its place with no words',
          actual: [exported.messaging_messages?.length, row],
          expected: [1, { text: null, removed: true }],
        });
      } finally {
        await client.unsafe('delete from messaging_channels where id=$1', [
          channelId,
        ]);
      }
    });
  });
});
