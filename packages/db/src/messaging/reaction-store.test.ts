import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { channelWire } from './channel-wire.test-support';
import { createMessagingReactionStore } from './reaction-store';
setupRitewayBun();
const messageId = 'm'.repeat(24),
  policy = { reactionUnits: 8, choices: ['👍'] };
test('reaction store extends ordered authority discovery with scoped metadata on the same transaction handle', async () => {
  const f = channelWire([
    [{ id: messageId }],
    [{ reaction: '👍', count: '2', own: true }],
  ]);
  const calls: unknown[] = [],
    transactions: unknown[] = [];
  const store = createMessagingReactionStore(
    f.database,
    policy,
    async (tx, scope, authority, operation) => {
      transactions.push(tx);
      calls.push([scope, authority.fact, authority.accounts.length, operation]);
    },
  );
  const result = await store.read(f.scope, messageId);
  assert({
    given: 'actual Drizzle authority/channel mapping and a current summary',
    should:
      'lock accounts before the canonical pair/channel fence, pass current facts and retain the exact transaction for both reading checks',
    actual: [
      f.queries[1]?.query.includes('daisy_authorization_accounts'),
      f.queries[2]?.query.includes('daisy_messaging_channel_fence'),
      calls,
      transactions[0] === transactions[1],
      result,
    ],
    expected: [
      true,
      true,
      Array(2).fill([f.scope, f.fact, 2, 'read']),
      true,
      {
        version: 1,
        channelId: f.scope.channelId,
        messageId,
        changeVersion: 1,
        replayed: false,
        reactions: [{ reaction: '👍', count: 2, own: true }],
      },
    ],
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
    should: 'perform only discovery/account/pair/channel/counter reads',
    actual: [
      f.queries.length,
      f.queries.some(
        (query) =>
          query.query.includes('messaging_messages') ||
          query.query.includes('messaging_receipts') ||
          query.query.includes('messaging_reactions'),
      ),
    ],
    expected: [5, false],
  });
});
