import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { sendMessagingMessage } from './send';

setupRitewayBun();

test('authorization refusal never inspects a receipt or allocates protected writes', async () => {
  const calls: string[] = [];
  await assertRejects({
    given: 'a revoked actor retrying an existing request',
    should: 'authorize before any protected receipt or message read',
    actual: () =>
      sendMessagingMessage(
        {
          version: 1,
          channelId: 'c'.repeat(24),
          requestId: 'r'.repeat(24),
          text: 'Hello',
        },
        { kind: 'user', userId: 'u'.repeat(24), actorId: 'a'.repeat(24) },
        {
          bounds: { messageUnits: 4000, pageItems: 100 },
          store: {
            withChannel: async (_input, work) =>
              work({
                authorize: async () => {
                  calls.push('authorize');
                  throw createAppError('AUTHORIZATION');
                },
                readSendState: async () => {
                  calls.push('receipt');
                  throw new Error('Receipt must remain unread');
                },
                commitSend: async () => {
                  calls.push('write');
                },
              }),
          },
          ids: { next: () => 'm'.repeat(24) },
          clock: { now: () => '2026-10-09T18:00:00.000Z' },
          limit: async () => {
            calls.push('limit');
          },
        },
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'a denied retry',
    should: 'leave receipt/content/limiter/writes untouched',
    actual: calls,
    expected: ['authorize'],
  });
});
