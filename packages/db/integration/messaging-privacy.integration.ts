import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { lockAuthorizationActors } from '../src/authorization';
import { createMessagingPrivacyAdopter } from '../src/messaging';
import { readMessagingChannelFact } from '../src/messaging/social';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const now = '2026-10-09T18:00:00.000Z';

test('messaging rights erase subject associations atomically and preserve other contributions', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { userId, actorId, otherActorId, channelId, low, high } = fixture;
  const groupId = createId(),
    ownMessage = createId(),
    otherMessage = createId(),
    requestId = createId();
  const subject = { userId: userId!, actorId: actorId! };
  const adopter = createMessagingPrivacyAdopter();
  try {
    await client.unsafe(
      'update messaging_channels set message_sequence=2,change_version=2 where id=$1',
      [channelId],
    );
    await client.unsafe(
      "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,title) values($1,'private_group','social.private_group',1,'active','Shared title')",
      [groupId],
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
      "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level) values($1,$2,true,false,'all'),($1,$3,true,false,'all')",
      [channelId, actorId, otherActorId],
    );
    await client.unsafe(
      "insert into messaging_group_invitations(channel_id,invitee_actor_id,invited_by_actor_id,generation,state,invited_at,decided_at) values($1,$2,$3,1,'accepted',$4,$4)",
      [groupId, otherActorId, actorId, now],
    );
    await client.unsafe(
      "insert into messaging_social_commands(actor_id,request_id,kind,digest,result_channel_id,created_at) values($1,$2,'dm.request',$3,$4,$6),($5,$2,'dm.decide',$3,$4,$6),($5,$7,'group.create',$3,$8,$6)",
      [
        actorId,
        requestId,
        'b'.repeat(64),
        channelId,
        otherActorId,
        now,
        createId(),
        groupId,
      ],
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
        channels: exported.messaging_channels,
      },
      expected: { texts: ['Own private text'], channels: [] },
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
      (select count(*)::int from messaging_social_commands where actor_id=$1 or result_channel_id=$3) as commands,
      (select count(*)::int from messaging_group_invitations where invitee_actor_id=$1 or invited_by_actor_id=$1) as invitations,
      (select count(*)::int from messaging_social_commands where actor_id=$2) as other_commands,
      (select count(*)::int from messaging_receipts where actor_id=$2) as other_receipts,
      (select count(*)::int from messaging_group_grants where actor_id=$2) as other_grants`,
      [actorId, otherActorId, channelId],
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
        commands: 0,
        invitations: 0,
        other_commands: 1,
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
    await client.unsafe('delete from messaging_channels where id in ($1,$2)', [
      channelId,
      groupId,
    ]);
    await client.unsafe(
      'delete from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2',
      [low, high],
    );
    await client.unsafe(
      "delete from outbox where payload->>'channelId' in ($1,$2)",
      [channelId, groupId],
    );
    await fixture.cleanup();
    await client.close();
  }
});
