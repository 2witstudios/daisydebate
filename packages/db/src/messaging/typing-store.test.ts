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
