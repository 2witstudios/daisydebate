import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { createMessagingStore } from './store';
import { channelWire } from './channel-wire.test-support';
setupRitewayBun();
const requestId = 'r'.repeat(24),
  messageId = 'm'.repeat(24);

test('send frame binds receipt to current command and commits one thin bell with monotonic counters', async () => {
  const f = channelWire([[], [], [], [], [[1, '5']], []]);
  let authorizationCalls = 0;
  const store = createMessagingStore({
    database: f.database,
    authorize: async () => {
      authorizationCalls += 1;
    },
  });
  await store.withChannel(f.scope, async (frame) => {
    const command = {
      version: 1 as const,
      channelId: f.scope.channelId,
      requestId,
      text: 'Owned send',
    };
    const plan = {
      kind: 'create' as const,
      message: {
        id: messageId,
        channelId: f.scope.channelId,
        authorActorId: f.scope.actorId,
        sequence: 1,
        changeVersion: 2,
        text: command.text,
        createdAt: f.now,
        editedAt: null,
        removedAt: null,
      },
      receipt: { messageId, payloadDigest: 'd'.repeat(64) },
      doorbell: {
        kind: 'channel.changed' as const,
        channelId: f.scope.channelId,
        changeVersion: 2,
      },
    };
    await assertRejects({
      given: 'a send plan without an observed command',
      should: 'refuse writing an unbound receipt',
      actual: () => frame.commitSend(plan),
      code: 'CONFLICT',
    });
    const state = await frame.readSendState(command);
    await assertRejects({
      given: 'a plan with another author',
      should: 'refuse before message persistence',
      actual: () =>
        frame.commitSend({
          ...plan,
          message: { ...plan.message, authorActorId: 'z'.repeat(24) },
        }),
      code: 'CONFLICT',
    });
    await frame.commitSend(plan);
    assert({
      given: 'the admitted current command',
      should: 'commit the matching message/receipt and advance shared counters',
      actual: [
        state.receipt,
        state.existingMessage,
        state.reply,
        frame.counters,
        authorizationCalls,
      ],
      expected: [
        null,
        null,
        null,
        { channelId: f.scope.channelId, messageSequence: 1, changeVersion: 2 },
        4,
      ],
    });
  });
  assert({
    given: 'the successful write',
    should:
      'persist message, receipt and channel counter before one content-free bell',
    actual: f.queries.slice(6).map((q) => q.query.split(' ')[0]),
    expected: ['insert', 'insert', 'update', 'insert', 'select'],
  });
});
test('send frame refuses fresh authority loss and malformed command without inspecting private receipts', async () => {
  const f = channelWire([]);
  const denied = createMessagingStore({
    database: f.database,
    authorize: async () => {
      throw createAppError('AUTHORIZATION');
    },
  });
  await denied.withChannel(f.scope, async (frame) => {
    await assertRejects({
      given: 'fresh send authority loss',
      should: 'refuse receipt inspection',
      actual: () =>
        frame.readSendState({
          version: 1,
          channelId: f.scope.channelId,
          requestId,
          text: 'Draft',
        }),
      code: 'AUTHORIZATION',
    });
  });
  const available = channelWire([]);
  const store = createMessagingStore({
    database: available.database,
    authorize: async () => {},
  });
  await store.withChannel(available.scope, async (frame) => {
    for (const command of [
      {
        version: 1 as const,
        channelId: 'z'.repeat(24),
        requestId,
        text: 'Draft',
      },
      {
        version: 1 as const,
        channelId: available.scope.channelId,
        requestId: 'invalid',
        text: 'Draft',
      },
    ])
      await assertRejects({
        given: 'foreign channel or invalid receipt identifier',
        should: 'refuse before receipt query',
        actual: () => frame.readSendState(command),
        code: 'VALIDATION',
      });
  });
  assert({
    given: 'both boundary refusals',
    should: 'perform only the five canonical authority/counter reads',
    actual: [f.queries.length, available.queries.length],
    expected: [5, 5],
  });
});
