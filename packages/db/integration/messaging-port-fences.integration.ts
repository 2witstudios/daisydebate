import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createMessagingFileStore } from '../src/messaging/file-store';
import { createMessagingReactionStore } from '../src/messaging/reaction-store';
import { createMessagingTestFixture } from '../src/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';

const { databaseUrl: url } = requireTestServices(process.env);
setupRitewayBun();

test('native file and reaction ports share read fences and take a stream lock only to write', async () => {
  const client = new SQL(url);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, otherActorId, userId, channelId, now } = fixture;
  const scope = { actorId, userId, channelId };
  const statements: string[] = [];
  const db = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  const take = () => {
    const rows = statements.splice(0);
    const first = rows.findIndex((query) =>
      query.includes('daisy_authorization_read_accounts_v2('),
    );
    const second = rows.findIndex((query) =>
      query.includes('daisy_messaging_channel_read_fence('),
    );
    return {
      shared: first >= 0 && first < second,
      exclusive: rows.some((query) =>
        query.includes('daisy_messaging_channel_fence('),
      ),
      stream: rows.some(
        (query) =>
          query.includes('from messaging_channel_streams') &&
          query.endsWith('for update'),
      ),
      protected: rows.some((query) =>
        /"?messaging_(messages|receipts|reactions)\b/.test(query),
      ),
    };
  };
  const messageId = createId();
  const policy = { reactionUnits: 8, choices: ['👍'], distinctPerMessage: 1 };
  try {
    await client`update messaging_channel_streams set message_sequence=1,change_version=1 where channel_id=${channelId}`;
    await client`insert into messaging_messages(id, channel_id, author_actor_id, sequence, change_version, text, created_at) values(${messageId},${channelId},${actorId},1,1,'Proof message',${now})`;
    await client`insert into messaging_reactions(channel_id,message_id,actor_id,reaction) values(${channelId},${messageId},${actorId},'👍'),(${channelId},${messageId},${otherActorId},'👍')`;
    const files = createMessagingFileStore({
      database: db,
      authorize: () => async () => {},
    });
    await files.withChannel(scope, 'read', async () => {});
    const fileRead = take();
    await files.withChannel(scope, 'post', async () => {});
    const filePost = take();
    const frames: unknown[] = [];
    const checks: unknown[] = [];
    const reactions = createMessagingReactionStore(
      db,
      policy,
      async (tx, request, authority, operation) => {
        frames.push(tx);
        checks.push([
          request,
          authority.fact.channelId,
          authority.accounts.length,
          operation,
        ]);
      },
    );
    const result = await reactions.read(scope, messageId);
    const reactionRead = take();
    const refused = createMessagingReactionStore(db, policy, async () => {
      throw createAppError('AUTHORIZATION');
    });
    await assertRejects({
      given: 'a reaction frame with a fresh refusing fence',
      should: 'never read or write protected content',
      actual: () =>
        refused.change(
          scope,
          {
            version: 1,
            channelId,
            messageId,
            requestId: createId(),
            reaction: '👍',
            active: true,
          },
          '1'.repeat(64),
        ),
      code: 'AUTHORIZATION',
    });
    assert({
      given:
        'file read and post ports, an allowed reaction read and a refusing reaction change',
      should:
        'take shared fences in order, lock only writers, and reuse one scoped reaction transaction',
      actual: [
        fileRead,
        filePost,
        reactionRead,
        take(),
        frames.length === 2 && frames[0] === frames[1],
        checks,
        result,
      ],
      expected: [
        { shared: true, exclusive: false, stream: false, protected: false },
        { shared: true, exclusive: false, stream: true, protected: false },
        { shared: true, exclusive: false, stream: false, protected: true },
        { shared: true, exclusive: false, stream: true, protected: false },
        true,
        Array(2).fill([scope, channelId, 2, 'read']),
        {
          version: 1,
          channelId,
          messageId,
          changeVersion: 1,
          replayed: false,
          reactions: [{ reaction: '👍', count: 2, own: true }],
        },
      ],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
