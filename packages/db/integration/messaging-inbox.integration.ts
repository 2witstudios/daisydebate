import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createMessagingInboxPage,
  type MessagingInboxPolicy,
} from '../src/messaging/inbox-page';
import { readMessagingInboxSummary } from '../src/messaging/inbox-summary';
import {
  createMessagingTestFixture,
  seedMessagingTestDm,
} from '../src/testing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('inbox pages from one to many conversations use the same ordered batches', async () => {
  const client = new SQL(databaseUrl);
  const fixtures: Awaited<ReturnType<typeof createMessagingTestFixture>>[] = [];
  const extra: string[] = [];
  try {
    for (let index = 0; index < 8; index++)
      fixtures.push(await createMessagingTestFixture(client));
    const [reader] = fixtures;
    if (!reader) throw new Error('Missing fixture reader');
    const { userId, actorId, now } = reader;
    for (const { otherActorId } of fixtures.slice(1)) {
      const channelId = createId();
      extra.push(channelId);
      await seedMessagingTestDm(client, {
        actorId,
        otherActorId,
        channelId,
        now,
      });
    }
    const statements: string[] = [];
    const database = drizzle({
      client,
      logger: { logQuery: (query) => statements.push(query) },
    });
    const page = createMessagingInboxPage(database);
    type Decision = { readonly shown: true };
    const policy = (allow: boolean): MessagingInboxPolicy<Decision> => ({
      collection: () => {},
      decide: async () => (allow ? { shown: true } : null),
      summaryOf: () => ({ counterpartActorId: null, content: 'messages' }),
    });
    const small = await page({ userId, actorId, now, limit: 1 }, policy(true));
    const smallCount = statements.splice(0).length;
    const large = await page({ userId, actorId, now, limit: 8 }, policy(true));
    const largeStatements = statements.splice(0);
    const fences = largeStatements.flatMap((query) =>
      query.includes('daisy_authorization_read_accounts_v2')
        ? ['accounts']
        : query.includes('for share of p')
          ? ['pairs']
          : query.includes('daisy_messaging_channel_read_fence')
            ? ['channels']
            : [],
    );
    assert({
      given: 'a one-conversation page and a larger page with the same reader',
      should:
        'read, fence and summarize both in constant work and keep account, pair and channel order',
      actual: [
        small.entries.length,
        large.entries.length,
        smallCount === largeStatements.length,
        fences,
      ],
      expected: [1, 8, true, ['accounts', 'pairs', 'channels']],
    });
    const denied = await page(
      { userId, actorId, now, limit: 8 },
      policy(false),
    );
    const lastId = large.entries.at(-1)?.channelId;
    await client`insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence)
      select c.id,${actorId},false,true,'none',0 from messaging_channels c
      join messaging_dm_pairs p on p.channel_id=c.id
      where p.low_actor_id=${actorId} or p.high_actor_id=${actorId}`;
    statements.length = 0;
    const hiddenPage = await page(
      { userId, actorId, now, limit: 8 },
      policy(true),
    );
    assert({
      given: 'all selected channels denied or hidden',
      should:
        'advance without disclosing entries and avoid fencing hidden channels',
      actual: {
        denied,
        hidden: hiddenPage,
        channelFence: statements.some((query) => query.includes('read_fence')),
      },
      expected: {
        denied: { entries: [], nextAfter: `withheld~${lastId}` },
        hidden: { entries: [], nextAfter: `withheld~${lastId}` },
        channelFence: false,
      },
    });
    assert({
      given: 'the complete hidden collection is shorter than the page',
      should: 'finish without a continuation',
      actual: await page({ userId, actorId, now, limit: 9 }, policy(true)),
      expected: { entries: [], nextAfter: null },
    });
    statements.length = 0;
    await assertRejects({
      given: 'a caller without collection access',
      should: 'refuse the inbox',
      actual: () =>
        page(
          { userId, actorId, now, limit: 8 },
          {
            ...policy(true),
            collection: () => {
              throw createAppError('AUTHORIZATION');
            },
          },
        ),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'the refused collection',
      should: 'read only the requesting account without scanning associations',
      actual: statements.filter((query) => /^\s*select/.test(query)).length,
      expected: 1,
    });
  } finally {
    try {
      for (const channelId of extra)
        await client`delete from messaging_channels where id=${channelId}`;
      const reader = fixtures[0];
      if (reader) {
        await client`delete from messaging_channels where id=${reader.channelId}`;
        await client`delete from contact_pairs where low_actor_id=${reader.actorId} or high_actor_id=${reader.actorId}`;
      }
      for (const fixture of fixtures) await fixture.cleanup();
    } finally {
      await client.close();
    }
  }
});

test('inbox summaries isolate selected history and report missing subjects', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, otherActorId, otherUserId, channelId, now } = fixture;
  const group = createId();
  const statements: string[] = [];
  const db = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query) },
  });
  const input = {
    channelId,
    actorId,
    counterpartActorId: otherActorId,
    content: 'messages',
  } as const;
  const message = 'Newest surviving content';
  try {
    await client`insert into public.messaging_messages
      (id,channel_id,author_actor_id,sequence,change_version,text,created_at,removed_at)
      values(${createId()},${channelId},${otherActorId},1,1,${message},${now},null),
      (${createId()},${channelId},${otherActorId},2,2,null,${now},${now})`;
    const conversation = await readMessagingInboxSummary(db, input);
    await client`update messaging_dm_pairs set request_state='pending',decided_at=null,
      request_sender_actor_id=${otherActorId},introduction='Invitation only' where channel_id=${channelId}`;
    const request = { ...input, content: 'introduction' as const };
    const incoming = await readMessagingInboxSummary(db, request);
    const outgoing = await readMessagingInboxSummary(db, {
      ...request,
      actorId: otherActorId,
      counterpartActorId: actorId,
    });
    await client`insert into messaging_channels
      (id,kind,policy_key,policy_revision,lifecycle,title,title_author_actor_id)
      values(${group},'private_group','social.private_group',1,'active','Policy club',${actorId})`;
    const groupSummary = await readMessagingInboxSummary(db, {
      ...input,
      channelId: group,
      counterpartActorId: null,
    });
    await client`update users set email=null,image=null,name='',deleted_at=now(),version=version+1
      where id=${otherUserId}`;
    const erased = await readMessagingInboxSummary(db, input);
    assert({
      given:
        'a visible message, a removed one, two sides of a request, a group title and a deleted user',
      should:
        'return only requested content, exact title and reader-specific unread state',
      actual: {
        conversation: [
          conversation.title,
          conversation.lastMessage?.text,
          conversation.unread,
        ],
        incoming: [
          incoming.lastMessage,
          incoming.introduction?.text,
          incoming.unread,
        ],
        outgoing: [outgoing.introduction?.fromSelf, outgoing.unread],
        group: [
          groupSummary.title,
          groupSummary.lastMessage,
          groupSummary.unread,
        ],
        erased: erased.title,
      },
      expected: {
        conversation: [otherUserId, message, true],
        incoming: [null, 'Invitation only', true],
        outgoing: [true, false],
        group: ['Policy club', null, false],
        erased: null,
      },
    });
    statements.length = 0;
    await assertRejects({
      given: 'a malformed channel id',
      should: 'refuse before issuing a statement',
      actual: () =>
        readMessagingInboxSummary(db, { ...input, channelId: 'bad' }),
      code: 'VALIDATION',
    });
    assert({
      given: 'the malformed id',
      should: 'run no SQL',
      actual: statements,
      expected: [],
    });
    await assertRejects({
      given: 'an absent, well-formed channel id',
      should: 'report it as missing',
      actual: () =>
        readMessagingInboxSummary(db, { ...input, channelId: createId() }),
      code: 'NOT_FOUND',
    });
  } finally {
    try {
      await client`delete from messaging_channels where id=${group}`;
      await fixture.cleanup();
    } finally {
      await client.close();
    }
  }
});
