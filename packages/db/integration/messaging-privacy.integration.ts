import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { lockAuthorizationActors } from '../src/authorization';
import { createMessagingPrivacyAdopter } from '../src/messaging';
import { readMessagingChannelFact } from '../src/messaging/social';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const now = '2026-10-09T18:00:00.000Z';

test('messaging rights erase subject associations atomically and preserve other contributions', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const [
    userId,
    otherUserId,
    actorId,
    otherActorId,
    channelId,
    groupId,
    ownMessage,
    otherMessage,
    requestId,
  ] = Array.from({ length: 9 }, createId);
  const [low, high] = [actorId!, otherActorId!].sort();
  const subject = { userId: userId!, actorId: actorId! };
  const adopter = createMessagingPrivacyAdopter();
  try {
    await client.unsafe(
      'insert into users(id,username,email_verified) values($1,$1,true),($2,$2,true)',
      [userId, otherUserId],
    );
    await client.unsafe(
      "insert into actors(id,kind,user_id) values($1,'human',$2),($3,'human',$4)",
      [actorId, userId, otherActorId, otherUserId],
    );
    await client.unsafe(
      'insert into messaging_contact_pairs(low_actor_id,high_actor_id) values($1,$2)',
      [low, high],
    );
    await client.unsafe(
      "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,title,message_sequence,change_version) values($1,'dm','social.dm',1,'active',null,2,2),($2,'private_group','social.private_group',1,'active','Shared title',0,0)",
      [channelId, groupId],
    );
    await client.unsafe(
      "insert into messaging_dm_pairs(low_actor_id,high_actor_id,channel_id,request_sender_actor_id,request_state,requested_at,decided_at) values($1,$2,$3,$4,'accepted',$5,$5)",
      [low, high, channelId, actorId, now],
    );
    await client.unsafe(
      "insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values($1,$2,'manager',1,$4),($1,$3,'member',1,$4)",
      [groupId, actorId, otherActorId, now],
    );
    await client.unsafe(
      "insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,1,1,'Own private text',$6),($4,$2,$5,2,2,'Other private text',$6)",
      [ownMessage, channelId, actorId, otherMessage, otherActorId, now],
    );
    await client.unsafe(
      'insert into messaging_receipts(channel_id,actor_id,request_id,payload_digest,message_id) values($1,$2,$3,$4,$5),($1,$6,$3,$4,$7)',
      [
        channelId,
        actorId,
        requestId,
        'a'.repeat(64),
        ownMessage,
        otherActorId,
        otherMessage,
      ],
    );
    await client.unsafe(
      "insert into messaging_reactions(channel_id,message_id,actor_id,reaction) values($1,$2,$3,'yes'),($1,$2,$4,'yes')",
      [channelId, otherMessage, actorId, otherActorId],
    );
    await client.unsafe(
      'insert into messaging_actor_states(channel_id,actor_id) values($1,$2),($1,$3)',
      [channelId, actorId, otherActorId],
    );
    const exported = await database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [subject.actorId], { maxActors: 1 });
      return adopter.export(tx, subject);
    });
    assert({
      given: 'a subject sharing a DM and group with another author',
      should: 'export only subject-authored text and no unowned shared title',
      actual: {
        texts: exported.messaging_messages?.map((row) => row.text),
        hasChannels: 'messaging_channels' in exported,
      },
      expected: { texts: ['Own private text'], hasChannels: false },
    });
    try {
      await database.transaction(async (tx) => {
        await lockAuthorizationActors(tx, [subject.actorId], { maxActors: 1 });
        await adopter.erase(tx, subject, { now });
        throw new Error('rollback privacy proof');
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'rollback privacy proof'
      )
        throw error;
    }
    const [rolledBack] = await client.unsafe(
      "select text,(select count(*)::int from outbox where payload->>'channelId'=$2) as bells from messaging_messages where id=$1",
      [ownMessage, channelId],
    );
    assert({
      given: 'cleanup followed by a transaction failure',
      should: 'roll back content and its outbox doorbells together',
      actual: rolledBack,
      expected: { text: 'Own private text', bells: 0 },
    });
    await database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [subject.actorId], { maxActors: 1 });
      await adopter.erase(tx, subject, { now });
    });
    const messages = await client.unsafe(
      'select author_actor_id,text,removed_at is not null as removed from messaging_messages where channel_id=$1 order by sequence',
      [channelId],
    );
    const [counts] = await client.unsafe(
      `select
      (select count(*)::int from messaging_receipts where actor_id=$1) as receipts,
      (select count(*)::int from messaging_group_grants where actor_id=$1) as grants,
      (select count(*)::int from messaging_contact_pairs where low_actor_id=$1 or high_actor_id=$1) as contacts,
      (select count(*)::int from messaging_dm_pairs where low_actor_id=$1 or high_actor_id=$1) as pairs,
      (select count(*)::int from messaging_reactions where actor_id=$1) as reactions,
      (select count(*)::int from messaging_actor_states where actor_id=$1) as preferences,
      (select count(*)::int from messaging_receipts where actor_id=$2) as other_receipts,
      (select count(*)::int from messaging_group_grants where actor_id=$2) as other_grants`,
      [actorId, otherActorId],
    );
    assert({
      given: 'committed erasure',
      should:
        'delete all subject private associations while preserving other receipts and grants',
      actual: counts,
      expected: {
        receipts: 0,
        grants: 0,
        contacts: 0,
        pairs: 0,
        reactions: 0,
        preferences: 0,
        other_receipts: 1,
        other_grants: 1,
      },
    });
    assert({
      given: 'committed erasure with another author',
      should:
        'scrub only subject text and preserve the other contribution physically',
      actual: messages,
      expected: [
        { author_actor_id: actorId, text: null, removed: true },
        {
          author_actor_id: otherActorId,
          text: 'Other private text',
          removed: false,
        },
      ],
    });
    const [group] = await client.unsafe(
      'select title,lifecycle from messaging_channels where id=$1',
      [groupId],
    );
    const fact = await readMessagingChannelFact(
      database,
      channelId!,
      otherActorId!,
    );
    const bells = await database.execute(
      sql`select payload from outbox where payload->>'channelId' in (${channelId!},${groupId!}) order by topic`,
    );
    assert({
      given: 'deleted DM authority and an unowned shared title',
      should:
        'fail closed without inventing survivor access and preserve the title with content-free change notifications',
      actual: {
        fact,
        group,
        bells: (bells as unknown as { payload: Record<string, unknown> }[]).map(
          (row) => Object.keys(row.payload).sort(),
        ),
      },
      expected: {
        fact: null,
        group: { title: 'Shared title', lifecycle: 'archived' },
        bells: [
          ['changeVersion', 'channelId', 'kind'],
          ['changeVersion', 'channelId', 'kind'],
        ],
      },
    });
  } finally {
    await client.close();
  }
});
