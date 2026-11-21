import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingPreferenceStore } from '../src/messaging/preference-store';
import { clearOwnMessagingPreference } from '../src/messaging/preference-clear';
import { channelPreferenceFrame } from '../src/messaging/preference-frame';
import { createMessagingTestFixture } from '../src/testing';
import type { Tx } from '../src/tx';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('an unfollowed reader counts only surviving unread peer messages', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, otherActorId, channelId, now } = fixture;
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const scope = { actorId, channelId };
  const choices = {
    following: false,
    hidden: true,
    notificationLevel: 'none' as const,
  };
  const frame = channelPreferenceFrame(database, scope, async () => {});
  try {
    const absent = await frame.read();
    const absentWrites = statements.filter((query) => query.includes('insert'));
    await client`update messaging_channel_streams set message_sequence=5, change_version=5 where channel_id=${channelId}`;
    for (const [sequence, owner, removed] of [
      [1, otherActorId, false],
      [2, actorId, false],
      [3, otherActorId, true],
      [4, otherActorId, false],
      [5, otherActorId, false],
    ] as const) {
      await client`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at,removed_at)
        values(${createId()},${channelId},${owner},${sequence},${sequence},${removed ? null : 'Proof message'},${now},${removed ? now : null})`;
    }
    await client`insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values(${channelId},${actorId},false,true,'none',1)`;
    const read = await frame.read();
    const updated = await frame.update(choices);
    const next = statements.length;
    const refused = channelPreferenceFrame(database, scope, async () => {
      throw createAppError('NOT_FOUND');
    });
    for (const attempt of [() => refused.read(), () => refused.update(choices)])
      await assertRejects({
        given: 'an existing preference without current authority',
        should: 'refuse before SQL',
        actual: attempt,
        code: 'NOT_FOUND',
      });
    assert({
      given:
        'no saved state, then a hidden unfollowed preference with peer, own, removed and earlier messages',
      should:
        'preserve honest absence, count only unread surviving peer messages and retain the saved cursor',
      actual: [absent, absentWrites, read, updated, statements.length - next],
      expected: [
        { state: null, unread: 0 },
        [],
        { state: { ...choices, readSequence: 1 }, unread: 2 },
        { ...choices, readSequence: 1 },
        0,
      ],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('clear fences the persisted own preference and leaves its counterpart intact', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, otherActorId, userId, channelId } = fixture;
  const scope = { actorId, userId, channelId };
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const erase = (
    authorize: Parameters<typeof clearOwnMessagingPreference>[2],
  ) =>
    database.transaction((tx) =>
      clearOwnMessagingPreference(tx, scope, authorize),
    );
  try {
    await client`insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence)
      values(${channelId},${actorId},true,false,'all',0),(${channelId},${otherActorId},true,false,'all',0)`;
    await assertRejects({
      given: 'a real preference but a refused self fence',
      should: 'refuse clear with authorization',
      actual: () =>
        erase(async () => {
          throw createAppError('AUTHORIZATION');
        }),
      code: 'AUTHORIZATION',
    });
    const refusedWrites = statements.filter((query) =>
      query.toLowerCase().startsWith('delete'),
    );
    statements.length = 0;
    const facts: unknown[] = [];
    const capture: Parameters<typeof clearOwnMessagingPreference>[2] = async (
      _tx,
      actual,
      { fact, accounts },
    ) => {
      facts.push([actual, fact, accounts[0]?.actorId]);
    };
    const cleared = await erase(capture);
    const clearStatements = statements.splice(0);
    const again = await erase(capture);
    const remaining =
      await client`select actor_id from messaging_actor_states where channel_id=${channelId}`;
    assert({
      given: 'one successful clear and an empty replay after the refusal',
      should:
        'fence account first and lock the own row, report null on replay, and keep the counterpart’s preference',
      actual: [
        refusedWrites,
        cleared,
        again,
        clearStatements[0]?.includes('daisy_authorization_accounts'),
        clearStatements[1]?.includes('for update'),
        facts,
        [...remaining],
      ],
      expected: [
        [],
        true,
        false,
        true,
        true,
        [
          [scope, { kind: 'channel_preference', actorId, channelId }, actorId],
          [scope, null, actorId],
        ],
        [{ actor_id: otherActorId }],
      ],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('preference updates require their own authority and read back the current state', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, userId, channelId } = fixture;
  const scope = { actorId, userId, channelId };
  const operations: unknown[] = [];
  let updateTx: Tx | undefined;
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const desired = {
    following: true,
    hidden: false,
    notificationLevel: 'all' as const,
  };
  const store = createMessagingPreferenceStore(database, {
    read: async (tx, input, frame) => {
      operations.push(['read', input, frame.fact.channelId, tx === updateTx]);
    },
    update: async (tx, input, frame) => {
      updateTx = tx;
      operations.push(['update', input, frame.fact.channelId]);
    },
    clear: async () => {
      throw new Error('Unexpected clear');
    },
  });
  try {
    await client`update messaging_channel_streams set message_sequence=4, change_version=4 where channel_id=${channelId}`;
    await client`insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence)
      values(${channelId},${actorId},false,false,'none',4)`;
    const changed = await store.update(scope, desired);
    assert({
      given:
        'a preference update on a real channel that already has read progress',
      should:
        'authorize update and read separately in the same frame and retain the read sequence',
      actual: [changed, operations],
      expected: [
        { state: { ...desired, readSequence: 4 }, unread: 0 },
        [
          ['update', scope, channelId],
          ['read', scope, channelId, true],
        ],
      ],
    });
    statements.length = 0;
    operations.length = 0;
    const rejected = createMessagingPreferenceStore(database, {
      read: async () => {
        operations.push('read');
      },
      update: async () => {
        operations.push('update');
        throw createAppError('AUTHORIZATION');
      },
      clear: async () => {
        throw new Error('Unexpected clear');
      },
    });
    await assertRejects({
      given: 'a reader that cannot update current preferences',
      should: 'refuse an attempted change',
      actual: () => rejected.update(scope, { ...desired, hidden: true }),
      code: 'AUTHORIZATION',
    });
    const [{ hidden }] = await client`select hidden from messaging_actor_states
      where channel_id=${channelId} and actor_id=${actorId}`;
    assert({
      given: 'the refusal with the real account, pair and channel fences',
      should: 'settle before reading or writing actor preferences',
      actual: [
        operations,
        statements.some((query) => query.includes('messaging_actor_states')),
        hidden,
      ],
      expected: [['update'], false, false],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
