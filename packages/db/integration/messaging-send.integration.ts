import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingStore } from '../src/messaging/store';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('fresh messaging transactions bind the canonical actor and acquire current authority', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const userId = createId();
  const actorId = createId();
  const otherUserId = createId();
  const otherActorId = createId();
  const channelId = createId();
  const [low, high] = [actorId, otherActorId].sort();
  try {
    await client.unsafe(
      'insert into users(id, username, email_verified) values ($1,$1,true),($2,$2,true)',
      [userId, otherUserId],
    );
    await client.unsafe(
      "insert into actors(id,kind,user_id) values ($1,'human',$2),($3,'human',$4)",
      [actorId, userId, otherActorId, otherUserId],
    );
    await client.unsafe(
      'insert into messaging_contact_pairs(low_actor_id,high_actor_id) values ($1,$2)',
      [low, high],
    );
    await client.unsafe(
      "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle) values ($1,'dm','social.dm',1,'active')",
      [channelId],
    );
    await client.unsafe(
      "insert into messaging_dm_pairs(low_actor_id,high_actor_id,channel_id,request_sender_actor_id,request_state,requested_at,decided_at) values ($1,$2,$3,$4,'accepted',now(),now())",
      [low, high, channelId, actorId],
    );
    const result = await createMessagingStore({ database }).withChannel(
      { channelId, actorId, userId },
      async (frame) => ({
        fact: frame.fact,
        member: frame.accounts.some(
          (account) =>
            account?.actorId === actorId &&
            account.userId === userId &&
            account.member,
        ),
        counters: frame.counters,
      }),
    );
    assert({
      given: 'a durable accepted DM and live bound account',
      should:
        'load current canonical authority and empty independent counters in one transaction',
      actual: {
        member: result.member,
        authority: result.fact.authority.kind,
        counters: result.counters,
      },
      expected: {
        member: true,
        authority: 'dm',
        counters: { channelId, messageSequence: 0, changeVersion: 0 },
      },
    });
  } finally {
    await client.unsafe('delete from messaging_channels where id = $1', [
      channelId,
    ]);
    await client.unsafe(
      'delete from messaging_contact_pairs where low_actor_id = $1 and high_actor_id = $2',
      [low, high],
    );
    await client.unsafe('delete from actors where id in ($1,$2)', [
      actorId,
      otherActorId,
    ]);
    await client.unsafe('delete from users where id in ($1,$2)', [
      userId,
      otherUserId,
    ]);
    await client.close();
  }
});
