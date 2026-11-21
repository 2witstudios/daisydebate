import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { createMessagingStore } from '../src/messaging/store';
import { invalidateChannelInboxes } from '../src/messaging/inbox-change';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('send binds a real observed receipt, advances once and refuses protected discovery without authority', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, userId, channelId, now } = fixture;
  const scope = { actorId, userId, channelId };
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  const requestId = createId();
  const messageId = createId();
  const command = {
    version: 1 as const,
    channelId,
    requestId,
    text: 'Proof send',
  };
  let checks = 0;
  const allow = createMessagingStore({
    database,
    authorize: async () => {
      checks++;
    },
  });
  const deny = createMessagingStore({
    database,
    authorize: async () => {
      throw createAppError('AUTHORIZATION');
    },
  });
  try {
    await assertRejects({
      given: 'fresh authority loss',
      should: 'refuse before receipt discovery',
      actual: () =>
        deny.withChannel(scope, (frame) => frame.readSendState(command)),
      code: 'AUTHORIZATION',
    });
    const blocked = statements.splice(0);
    await allow.withChannel(scope, async (frame) => {
      for (const invalid of [
        { ...command, channelId: createId() },
        { ...command, requestId: 'invalid' },
      ])
        await assertRejects({
          given: 'foreign channel or invalid receipt',
          should: 'refuse before receipt discovery',
          actual: () => frame.readSendState(invalid),
          code: 'VALIDATION',
        });
    });
    const malformed = statements.splice(0);
    checks = 0;
    const written = await allow.withChannel(scope, async (frame) => {
      const plan = {
        kind: 'create' as const,
        message: {
          id: messageId,
          channelId,
          authorActorId: actorId,
          sequence: 1,
          changeVersion: 1,
          text: command.text,
          createdAt: now,
          editedAt: null,
          removedAt: null,
        },
        receipt: { messageId, payloadDigest: 'd'.repeat(64) },
      };
      await assertRejects({
        given: 'a plan without a read receipt in this frame',
        should: 'refuse an unbound send',
        actual: () => frame.commitSend(plan),
        code: 'CONFLICT',
      });
      const state = await frame.readSendState(command);
      await assertRejects({
        given: 'an observed plan with an unrelated actor',
        should: 'refuse mismatched message provenance',
        actual: () =>
          frame.commitSend({
            ...plan,
            message: { ...plan.message, authorActorId: createId() },
          }),
        code: 'CONFLICT',
      });
      await frame.commitSend(plan);
      return [
        state.receipt,
        state.existingMessage,
        state.reply,
        frame.counters,
      ];
    });
    const [stored] =
      await client`select m.text, m.sequence::int as sequence, m.change_version::int as version, r.message_id from messaging_messages m join messaging_receipts r on r.message_id=m.id where r.request_id=${requestId}`;
    const [channelBells] =
      await client`select count(*)::int as count from outbox where topic=${`channel:${channelId}`}`;
    assert({
      given: 'refusal, malformed requests and one valid send in a real channel',
      should:
        'leave protected reads untouched on refusal and persist exactly the observed receipt and counter advance without a channel bell',
      actual: [
        [blocked, malformed].map((rows) =>
          rows.some((query) => query.includes('messaging_receipts')),
        ),
        written,
        checks,
        stored,
        channelBells?.count,
      ],
      expected: [
        [false, false],
        [null, null, null, { channelId, messageSequence: 1, changeVersion: 1 }],
        4,
        { text: command.text, sequence: 1, version: 1, message_id: messageId },
        0,
      ],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('fresh messaging transactions bind the canonical actor and acquire current authority', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { userId, actorId, channelId } = fixture;
  try {
    await assertRejects({
      given: 'a fresh locked channel whose canonical authorizer refuses',
      should: 'refuse protected receipt reads inside the same transaction',
      actual: () =>
        createMessagingStore({
          database,
          authorize: async () => {
            throw createAppError('AUTHORIZATION');
          },
        }).withChannel({ channelId, actorId, userId }, async (frame) => {
          await frame.authorize();
          return frame.readSendState({
            version: 1,
            channelId,
            requestId: createId(),
            text: 'Forbidden',
          });
        }),
      code: 'AUTHORIZATION',
    });
    const result = await createMessagingStore({
      database,
      authorize: async () => {},
    }).withChannel({ channelId, actorId, userId }, async (frame) => ({
      fact: frame.fact,
      member: frame.accounts.some(
        (account) =>
          account?.actorId === actorId &&
          account.userId === userId &&
          account.member,
      ),
      counters: frame.counters,
    }));
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
    await fixture.cleanup();
    await client.close();
  }
});

test('a channel change rings both DM members’ inbox doorbells with no channel or content (ISSUE-603)', async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { actorId, otherActorId, channelId } = fixture;
  try {
    await database.transaction((tx) =>
      invalidateChannelInboxes(tx, channelId!),
    );
    const bells = (await client.unsafe(
      "select topic, payload from outbox where kind='messaging.inbox.changed' and topic in ($1,$2) order by topic",
      [`user:${actorId}:inbox`, `user:${otherActorId}:inbox`],
    )) as { topic: string; payload: unknown }[];
    assert({
      given: 'a send, edit or removal in a DM',
      should:
        'append one content-free inbox bell per member, naming no channel',
      actual: bells.map((bell) => [bell.topic, bell.payload]),
      expected: [actorId, otherActorId]
        .sort()
        .map((id) => [`user:${id}:inbox`, { kind: 'messaging.inbox.changed' }]),
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
