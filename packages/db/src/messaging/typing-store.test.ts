import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../scripted-bun-wire';
import { createMessagingTypingStore } from './typing-store';
import { messagingAuthorityWire } from './channel-wire.test-support';
setupRitewayBun();
test('typing store fences full cast then publishes only validated thin hint in the caller transaction', async () => {
  const initial = messagingAuthorityWire([]);
  const f = messagingAuthorityWire([
    [{ fact: initial.fact }],
    [{ fact: initial.fact }],
  ]);
  // Peer facts are re-read after the same channel fence, not inferred from the lease.
  const { database, scope, fact, queries } = f;
  const store = createMessagingTypingStore(database);
  const value = await store(
    scope,
    2,
    async (frame) => {
      await frame.notify();
      return [
        frame.fact.channelId,
        frame.accounts.length,
        frame.channels.map((row) => row.fact?.channelId),
      ];
    },
    'write',
  );
  assert({
    given: 'current account/pair/channel fenced cast',
    should:
      'use one transaction and a channel-only non-position hint without inserting outbox',
    actual: [
      value,
      queries.slice(4).map((row) => row.query.includes('pg_notify')),
      queries.at(-1)?.params,
    ],
    expected: [
      [fact.channelId, 2, [fact.channelId, fact.channelId]],
      [false, false, true],
      [
        JSON.stringify({
          v: 1,
          type: 'typing_changed',
          topic: `channel:${scope.channelId}`,
        }),
      ],
    ],
  });
});
test('typing budget refusal happens before peer projection and notification', async () => {
  const f = messagingAuthorityWire([]);
  let invoked = false;
  await assertRejects({
    given: 'two cast accounts beyond explicit one-actor typing budget',
    should: 'refuse without publishing or querying lease facts',
    actual: () =>
      createMessagingTypingStore(f.database)(
        f.scope,
        1,
        async () => {
          invoked = true;
        },
        'write',
      ),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'refused aggregate computation',
    should: 'perform only canonical authority locks and reads',
    actual: [invoked, f.queries.length],
    expected: [false, 4],
  });
});

test('typing read takes shared fences, never the exclusive writer fence, and never notifies', async () => {
  const { scope, fact } = messagingAuthorityWire([]);
  const accounts = ['a'.repeat(24), 'b'.repeat(24)].map((actorId, i) => ({
    actorId,
    userId: (i ? 'v' : 'u').repeat(24),
    member: true,
    erased: false,
    revision: 1,
  }));
  const readOnce = () => {
    const { client, queries: sharedQueries } = fakeSql([
      [],
      [{ fact }],
      accounts,
      [{ id: scope.channelId }],
      [{ fact }],
      [{ fact }],
      [{ fact }],
    ]);
    return {
      store: createMessagingTypingStore(drizzle({ client })),
      sharedQueries,
    };
  };
  const first = readOnce();
  const value = await first.store(
    scope,
    2,
    async (frame) => frame.accounts.length,
    'read',
  );
  let notified: unknown;
  const second = readOnce();
  await assertRejects({
    given: 'a typing read frame',
    should: 'refuse any notification attempt',
    actual: () =>
      second.store(
        scope,
        2,
        async (frame) => {
          notified = 'called';
          await frame.notify();
        },
        'read',
      ),
    code: 'CONFLICT',
  });
  assert({
    given: 'a typing read',
    should:
      'read accounts through the shared reader under compatible fences, restartably, with no exclusive lock and no notification',
    actual: {
      value,
      sharedReader: first.sharedQueries.some((row) =>
        row.query.includes('daisy_authorization_read_accounts'),
      ),
      sharedChannelFence: first.sharedQueries.some((row) =>
        row.query.includes('daisy_observation_authority_fences'),
      ),
      exclusive:
        first.sharedQueries.some((row) =>
          /daisy_authorization_accounts\(|daisy_messaging_channel_fence/.test(
            row.query,
          ),
        ) ||
        first.sharedQueries.some(
          (row) =>
            row.query.includes('messaging_channel_streams') &&
            /for update/.test(row.query),
        ),
      notified,
    },
    expected: {
      value: 2,
      sharedReader: true,
      sharedChannelFence: true,
      exclusive: false,
      notified: 'called',
    },
  });
});
