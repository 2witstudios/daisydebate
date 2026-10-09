import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { createMessagingReadOperations } from './read';
setupRitewayBun();
test('search validates before its transaction and never turns authority outages into empty history', async () => {
  let entries = 0;
  let failure: 'AUTHORIZATION' | 'INFRASTRUCTURE' = 'AUTHORIZATION';
  const operation = createMessagingReadOperations({
    bounds: { messageUnits: 30, pageItems: 5 },
    store: {
      withChannel: async () => {
        entries += 1;
        throw createAppError(failure);
      },
    },
  });
  const principal = {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
  };
  const command = {
    version: 1,
    channelId: 'c'.repeat(24),
    query: 'private',
    limit: 2,
  };
  await assertRejects({
    given: 'a cursor belonging to a different channel',
    should: 'refuse before entering any transaction',
    actual: () =>
      operation.search(
        { ...command, before: { channelId: principal.actorId, sequence: 1 } },
        principal,
      ),
    code: 'VALIDATION',
  });
  assert({
    given: 'the refused foreign cursor',
    should: 'leave the store untouched',
    actual: entries,
    expected: 0,
  });
  for (const code of ['AUTHORIZATION', 'INFRASTRUCTURE'] as const) {
    failure = code;
    await assertRejects({
      given: `fresh canonical authority refusal ${code}`,
      should: 'propagate refusal rather than fabricate an empty search page',
      actual: () => operation.search(command, principal),
      code,
    });
  }
  assert({
    given: 'two protected attempts',
    should: 'enter the current authority frame each time',
    actual: entries,
    expected: 2,
  });
});
