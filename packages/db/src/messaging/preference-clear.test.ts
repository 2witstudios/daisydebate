import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { clearOwnMessagingPreference } from './preference-clear';
setupRitewayBun();
const scope = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  channelId: 'c'.repeat(24),
};
const account = {
  userId: scope.userId,
  actorId: scope.actorId,
  member: true,
  erased: false,
  revision: 2,
};
test('clear projects only an existing locked own row and deletes it after the canonical account fence', async () => {
  const { client, queries } = fakeSql([
    [account],
    [[scope.actorId, scope.channelId]],
    [],
    [[1, '5']],
    [],
  ]);
  const facts: unknown[] = [];
  const cleared = await clearOwnMessagingPreference(
    drizzle({ client }),
    scope,
    async (_tx, input, frame) => {
      facts.push([input, frame]);
    },
  );
  assert({
    given: 'an own persisted row after revocation',
    should:
      'lock the current account before the exact row and scope the delete to that row only',
    actual: [
      cleared,
      queries[0]?.query.includes('daisy_authorization_accounts'),
      queries[1]?.query.includes('for update'),
      queries[2]?.query.includes('delete'),
      queries[2]?.params,
      facts,
    ],
    expected: [
      true,
      true,
      true,
      true,
      [scope.channelId, scope.actorId],
      [
        [
          scope,
          {
            accounts: [account],
            fact: {
              kind: 'channel_preference',
              actorId: scope.actorId,
              channelId: scope.channelId,
            },
          },
        ],
      ],
    ],
  });
});
test('clear never invents an absent preference and erasure/refusal cannot touch it', async () => {
  const missing = fakeSql([[account], []]);
  let fact: unknown = 'unset';
  const result = await clearOwnMessagingPreference(
    drizzle({ client: missing.client }),
    scope,
    async (_tx, _input, frame) => {
      fact = frame.fact;
    },
  );
  assert({
    given: 'no own row',
    should:
      'authorize current self without synthesizing a clear fact or writing a row',
    actual: [result, fact, missing.queries.length],
    expected: [false, null, 2],
  });
  const denied = fakeSql([
    [{ ...account, erased: true, member: false }],
    [[scope.actorId, scope.channelId]],
  ]);
  await assertRejects({
    given: 'a current erased/refused self',
    should: 'refuse before any deletion',
    actual: () =>
      clearOwnMessagingPreference(
        drizzle({ client: denied.client }),
        scope,
        async () => {
          throw createAppError('AUTHORIZATION');
        },
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'refusal after fresh account and own-row locks',
    should: 'leave persisted state untouched',
    actual: denied.queries.some(({ query }) => query.startsWith('delete')),
    expected: false,
  });
});
