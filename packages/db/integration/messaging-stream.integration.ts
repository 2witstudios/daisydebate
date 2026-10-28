import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq } from 'drizzle-orm';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingStore } from '../src/messaging/store';
import { advanceSocialChannelAuthority } from '../src/messaging/social-channel-change';
import { messagingChannels } from '../src/schema/messaging-channels';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const streamOf = async (client: SQL, channelId: string) =>
  (
    await client.unsafe(
      `select s.message_sequence::text as sequence, s.change_version::text as version,
        c.authority_revision::int as revision,
        (select count(*)::int from outbox where payload->>'channelId'=$1) as bells
      from messaging_channel_streams s join messaging_channels c on c.id=s.channel_id
      where s.channel_id=$1`,
      [channelId],
    )
  )[0];

test('a stream overflow refuses the whole writer and rolls back its authority write (MSG-2.2-arch1)', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { channelId } = fixture;
  try {
    await client.unsafe(
      'update messaging_channel_streams set change_version=9007199254740991 where channel_id=$1',
      [channelId],
    );
    const before = await streamOf(client, channelId);
    await assertRejects({
      given: 'an authority change on a channel whose stream cannot advance',
      should: 'refuse with a conflict',
      actual: () =>
        database.transaction(async (tx) => {
          const [channel] = await tx
            .select()
            .from(messagingChannels)
            .where(eq(messagingChannels.id, channelId))
            .for('update');
          await advanceSocialChannelAuthority(tx, channel!);
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused allocation after the authority revision was written',
      should:
        'leave the authority revision, the stream counters and the doorbells unchanged',
      actual: await streamOf(client, channelId),
      expected: before,
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('two channels sharing their members both progress under concurrent sends (MSG-2.2-arch1)', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const groupId = createId();
  const sends = 6;
  try {
    await client.unsafe(
      "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle) values($1,'private_group','social.private_group',1,'active')",
      [groupId],
    );
    await client.unsafe(
      'insert into messaging_channel_streams(channel_id) values($1)',
      [groupId],
    );
    await client.unsafe(
      "insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values($1,$2,'manager',1,$4),($1,$3,'member',1,$4)",
      [groupId, fixture.actorId, fixture.otherActorId, fixture.now],
    );
    const store = createMessagingStore({ database, authorize: async () => {} });
    const send = (channelId: string, author: 'actor' | 'other') => {
      const scope =
        author === 'actor'
          ? { channelId, actorId: fixture.actorId, userId: fixture.userId }
          : {
              channelId,
              actorId: fixture.otherActorId,
              userId: fixture.otherUserId,
            };
      return store.withChannel(scope, async (frame) => {
        const command = {
          version: 1 as const,
          channelId,
          requestId: createId(),
          text: 'Concurrent',
        };
        const { counters } = await frame.readSendState(command);
        const messageId = createId();
        const changeVersion = counters.changeVersion + 1;
        await frame.commitSend({
          kind: 'create',
          message: {
            id: messageId,
            channelId,
            authorActorId: scope.actorId,
            sequence: counters.messageSequence + 1,
            changeVersion,
            text: command.text,
            createdAt: fixture.now,
            editedAt: null,
            removedAt: null,
          },
          receipt: { messageId, payloadDigest: 'd'.repeat(64) },
          doorbell: { kind: 'channel.changed', channelId, changeVersion },
        });
      });
    };
    await Promise.all(
      Array.from({ length: sends }, (_, index) => [
        send(fixture.channelId, index % 2 === 0 ? 'actor' : 'other'),
        send(groupId, index % 2 === 0 ? 'other' : 'actor'),
      ]).flat(),
    );
    const sequences = async (channelId: string) =>
      (
        await client.unsafe(
          'select sequence::int as sequence from messaging_messages where channel_id=$1 order by sequence',
          [channelId],
        )
      ).map((row: { sequence: number }) => row.sequence);
    const all = Array.from({ length: sends }, (_, index) => index + 1);
    assert({
      given:
        'interleaved concurrent sends by both members to their DM and group',
      should:
        'advance each channel’s own stream contiguously, with one bell per send',
      actual: {
        dm: await streamOf(client, fixture.channelId),
        group: await streamOf(client, groupId),
        dmSequences: await sequences(fixture.channelId),
        groupSequences: await sequences(groupId),
      },
      expected: {
        dm: {
          sequence: `${sends}`,
          version: `${sends}`,
          revision: 1,
          bells: sends,
        },
        group: {
          sequence: `${sends}`,
          version: `${sends}`,
          revision: 1,
          bells: sends,
        },
        dmSequences: all,
        groupSequences: all,
      },
    });
  } finally {
    await client.unsafe("delete from outbox where payload->>'channelId'=$1", [
      groupId,
    ]);
    await client.unsafe('delete from messaging_channels where id=$1', [
      groupId,
    ]);
    await fixture.cleanup();
    await client.close();
  }
});
