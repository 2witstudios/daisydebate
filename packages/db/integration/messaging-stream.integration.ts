import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq } from 'drizzle-orm';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingStore } from '../src/messaging/store';
import { sqlStateOf } from './constraint-helpers';
import { advanceSocialChannelAuthority } from '../src/messaging/social-channel-change';
import { messagingChannels } from '../src/schema/messaging-channels';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

type Fixture = Awaited<ReturnType<typeof createMessagingTestFixture>>;
/** One real send through the content frame; `hold` runs inside it, before the commit. */
const sender =
  (store: ReturnType<typeof createMessagingStore>, fixture: Fixture) =>
  (
    channelId: string,
    author: 'actor' | 'other',
    hold: () => Promise<void> = async () => {},
  ) => {
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
      await hold();
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
const insertGroup = async (client: SQL, fixture: Fixture, groupId: string) => {
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
};

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
    await insertGroup(client, fixture, groupId);
    const send = sender(
      createMessagingStore({ database, authorize: async () => {} }),
      fixture,
    );
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

/** 'done' when the work finishes while the holder still holds; 'blocked' otherwise. */
const settlesWhileHeld = async (work: Promise<unknown>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => 'done'),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('blocked'), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
/** A probe transaction with a short lock_timeout: 'accepted' or the SQLSTATE that refused it. */
const probe = (url: string, attempt: (sql: SQL) => Promise<unknown>) => {
  const other = new SQL(url);
  return sqlStateOf(() =>
    other.begin(async (tx) => {
      await tx`set local lock_timeout = '300ms'`;
      await attempt(tx);
    }),
  ).finally(() => other.close());
};

test('a held append blocks neither peers nor readers on the authority fence, while a revocation still waits (MSG-2.2-arch1)', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const groupId = createId();
  const { channelId, low, high } = fixture;
  try {
    await insertGroup(client, fixture, groupId);
    const store = createMessagingStore({ database, authorize: async () => {} });
    const send = sender(store, fixture);
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holding = send(channelId, 'actor', async () => {
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const actors = [fixture.actorId, fixture.otherActorId].sort();
    const whileHeld = {
      peerChannel: await settlesWhileHeld(send(groupId, 'other')),
      reader: await settlesWhileHeld(
        store.readChannel(
          {
            channelId,
            actorId: fixture.otherActorId,
            userId: fixture.otherUserId,
          },
          (frame) => frame.history({ limit: 10 }),
        ),
      ),
      appendFences: await probe(databaseUrl, async (sql) => {
        await sql`select * from public.daisy_authorization_read_accounts_v2(array[${actors[0]!}, ${actors[1]!}]::text[])`;
        await sql`select public.daisy_messaging_channel_read_fence(${channelId}, ${low}, ${high})`;
      }),
      appendStream: await probe(
        databaseUrl,
        (sql) =>
          sql`select 1 from messaging_channel_streams where channel_id=${channelId} for update`,
      ),
      revocation: await probe(
        databaseUrl,
        (sql) =>
          sql`select public.daisy_messaging_channel_fence(${channelId}, ${low}, ${high})`,
      ),
    };
    const second = send(channelId, 'other');
    release.resolve();
    await Promise.all([holding, second]);
    assert({
      given:
        'a content transaction on a DM held open after its fences and stream lock',
      should:
        'let a same-member group send and a DM reader finish, admit a second append through the shared fences but order it on the stream row, and make a revocation wait',
      actual: {
        ...whileHeld,
        dm: await streamOf(client, channelId),
      },
      expected: {
        peerChannel: 'done',
        reader: 'done',
        appendFences: 'accepted',
        appendStream: '55P03',
        revocation: '55P03',
        dm: { sequence: '2', version: '2', revision: 1, bells: 2 },
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
