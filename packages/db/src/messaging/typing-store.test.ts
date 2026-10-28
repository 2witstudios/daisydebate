import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
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
  const value = await store(scope, 2, async (frame) => {
    await frame.notify();
    return [
      frame.fact.channelId,
      frame.accounts.length,
      frame.channels.map((row) => row.fact?.channelId),
    ];
  });
  assert({
    given: 'a typing update in a channel',
    should:
      'fence accounts and the channel shared, never exclusively (MSG-2.1-arch1)',
    actual: {
      shared: [
        queries.some((row) =>
          row.query.includes('daisy_authorization_read_accounts_v2('),
        ),
        queries.some((row) =>
          row.query.includes('daisy_messaging_channel_read_fence('),
        ),
      ],
      exclusive: queries.some(
        (row) =>
          row.query.includes('daisy_messaging_channel_fence(') ||
          row.query.includes('daisy_authorization_accounts_v2('),
      ),
    },
    expected: { shared: [true, true], exclusive: false },
  });
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
      createMessagingTypingStore(f.database)(f.scope, 1, async () => {
        invoked = true;
      }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'refused aggregate computation',
    should: 'perform only canonical authority locks and reads',
    actual: [invoked, f.queries.length],
    expected: [false, 4],
  });
});
