import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../scripted-bun-wire';
import { channelWire } from './channel-wire.test-support';
import { messagingAuthorityFixture } from './social.test-support';
import { createMessagingReactionStore } from './reaction-store';
setupRitewayBun();
const messageId = 'm'.repeat(24),
  policy = { reactionUnits: 8, choices: ['👍'] };
test('reaction read takes shared fences and the stream high-water mark, never the exclusive writer fence', async () => {
  const fact = messagingAuthorityFixture();
  const scope = {
    actorId: 'a'.repeat(24),
    userId: 'u'.repeat(24),
    channelId: fact.channelId,
  };
  const accounts = ['a'.repeat(24), 'b'.repeat(24)].map((actorId, i) => ({
    actorId,
    userId: (i ? 'v' : 'u').repeat(24),
    member: true,
    erased: false,
    revision: 1,
  }));
  const { client, queries } = fakeSql([
    [],
    [{ fact }],
    accounts,
    [{ id: scope.channelId }],
    [{ fact }],
    [[0, 1]],
    [{ id: messageId }],
    [{ reaction: '👍', count: '2', own: true }],
  ]);
  const calls: unknown[] = [];
  const transactions: unknown[] = [];
  const store = createMessagingReactionStore(
    drizzle({ client }),
    policy,
    async (tx, current, authority, operation) => {
      transactions.push(tx);
      calls.push([
        (current as { channelId: string }).channelId,
        authority.fact.channelId,
        authority.accounts.length,
        operation,
      ]);
    },
  );
  const result = await store.read(scope, messageId);
  assert({
    given: 'a reaction summary read',
    should:
      'read accounts through the shared reader under compatible fences with the unlocked stream high-water mark, pass current facts on one transaction, never an exclusive lock',
    actual: {
      result,
      sharedReader: queries.some((row) =>
        row.query.includes('daisy_authorization_read_accounts'),
      ),
      sharedChannelFence: queries.some((row) =>
        row.query.includes('daisy_observation_authority_fences'),
      ),
      // The authority and stream fences must be shared; the summary read's
      // own message-row lock is the reaction frame's pre-existing child-row
      // behavior, not part of the authority fence contract.
      exclusive:
        queries.some((row) =>
          /daisy_authorization_accounts\(|daisy_messaging_channel_fence/.test(
            row.query,
          ),
        ) ||
        queries.some(
          (row) =>
            row.query.includes('messaging_channel_streams') &&
            /for update/.test(row.query),
        ),
      calls,
      oneTransaction: transactions[0] === transactions[1],
    },
    expected: {
      result: {
        version: 1,
        channelId: scope.channelId,
        messageId,
        changeVersion: 1,
        replayed: false,
        reactions: [{ reaction: '👍', count: 2, own: true }],
      },
      sharedReader: true,
      sharedChannelFence: true,
      exclusive: false,
      calls: Array(2).fill([scope.channelId, fact.channelId, 2, 'read']),
      oneTransaction: true,
    },
  });
});
test('reaction store invokes current operation fence before protected message, receipt or association SQL', async () => {
  const f = channelWire([]);
  const store = createMessagingReactionStore(f.database, policy, async () => {
    throw createAppError('AUTHORIZATION');
  });
  await assertRejects({
    given:
      'current account/channel facts whose operation fence refuses addition',
    should: 'deny without querying or mutating protected reaction state',
    actual: () =>
      store.change(
        f.scope,
        {
          version: 1,
          channelId: f.scope.channelId,
          messageId,
          requestId: 'r'.repeat(24),
          reaction: '👍',
          active: true,
        },
        '1'.repeat(64),
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the current fence refusal',
    should: 'perform only discovery/account/pair/channel/stream reads',
    actual: [
      f.queries.length,
      f.queries.some(
        (query) =>
          query.query.includes('messaging_messages') ||
          query.query.includes('messaging_receipts') ||
          query.query.includes('messaging_reactions'),
      ),
    ],
    expected: [6, false],
  });
});
