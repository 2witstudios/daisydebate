import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import {
  applyAppendDecisions,
  finalizeAppend,
  type AppendScratch,
} from './append-decisions';
import type { MessagingSendAttempt } from './append-contracts';
setupRitewayBun();
const channelId = 'c'.repeat(24);
function scratch(counter = 0): AppendScratch {
  const locked = { messageSequence: counter, changeVersion: counter };
  return {
    channelId,
    locked,
    counters: { ...locked, channelId },
    byReceipt: new Map(),
    messages: new Map(),
    creates: [],
    changed: new Map(),
    removed: new Set(),
    bells: [],
    replayed: new Set(),
    insertedReceipts: [],
  };
}
function attempt(request: string): MessagingSendAttempt {
  const actorId = 'a'.repeat(24);
  return {
    scope: { actorId, userId: 'u'.repeat(24), channelId },
    command: {
      version: 1,
      channelId,
      requestId: request.repeat(24),
      text: 'Body',
    },
    authorize: async () => {},
    admit: async () => {},
    decide: (state) => {
      if (!Number.isSafeInteger(state.counters.messageSequence + 1))
        throw createAppError('CONFLICT');
      const message = {
        id: request.repeat(24),
        channelId,
        authorActorId: actorId,
        sequence: state.counters.messageSequence + 1,
        changeVersion: state.counters.changeVersion + 1,
        text: 'Body',
        createdAt: '2026-10-14T00:00:00.000Z',
        editedAt: null,
        removedAt: null,
      };
      return {
        kind: 'create',
        message,
        receipt: { messageId: message.id, payloadDigest: '1'.repeat(64) },
        doorbell: {
          kind: 'channel.changed',
          channelId,
          changeVersion: message.changeVersion,
        },
      };
    },
  };
}
const allowed = { value: undefined };
test('counter capacity accounts only for accepted commands', () => {
  const state = scratch(Number.MAX_SAFE_INTEGER - 1);
  const denied = createAppError('RATE_LIMIT');
  const result = applyAppendDecisions(
    [attempt('r'), attempt('s')],
    [allowed, allowed],
    [allowed, { error: denied }],
    true,
    state,
  );
  assert({
    given: 'capacity for one command and a denied successor',
    should:
      'retain the allowed allocation without turning the denied command into overflow',
    actual: [
      state.creates.length,
      state.counters.messageSequence,
      'error' in result[1]! && result[1].error === denied,
    ],
    expected: [1, Number.MAX_SAFE_INTEGER, true],
  });
});
test('accepted overflow escapes command denials so the owning transaction rolls back', async () => {
  await assertRejects({
    given: 'two accepted commands with only one remaining counter',
    should: 'fail the entire transaction rather than committing a prefix',
    actual: async () =>
      applyAppendDecisions(
        [attempt('r'), attempt('s')],
        [allowed, allowed],
        [allowed, allowed],
        true,
        scratch(Number.MAX_SAFE_INTEGER - 1),
      ),
    code: 'INFRASTRUCTURE',
  });
});
test('finalization never returns earlier protected text after scratch removal', () => {
  const state = scratch();
  const results = applyAppendDecisions(
    [attempt('r')],
    [allowed],
    [allowed],
    true,
    state,
  );
  const message = state.creates[0]!.message;
  state.messages.set(message.id, {
    ...message,
    text: null,
    removedAt: message.createdAt,
    changeVersion: 2,
  });
  const finalized = finalizeAppend(results, state)[0]!;
  assert({
    given: 'a newly accepted message made unavailable before the same commit',
    should: 'derive the acknowledged content from final current availability',
    actual: 'value' in finalized && finalized.value?.text,
    expected: null,
  });
});
