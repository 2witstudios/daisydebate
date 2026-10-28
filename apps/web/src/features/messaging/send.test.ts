import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { sendMessagingMessage } from './send';
import { sendPayloadDigest } from './send-plan';

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
            // The preflight's own fence refuses first (MSG-2.2-arch1).
            readChannel: async (_input, work) =>
              work({
                readRequestState: async () => {
                  calls.push('authorize');
                  throw createAppError('AUTHORIZATION');
                },
              }),
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

test('the limiter runs before the write transaction and never for a replay (MSG-2.2-arch1)', async () => {
  const command = {
    version: 1 as const,
    channelId: 'c'.repeat(24),
    requestId: 'r'.repeat(24),
    text: 'Hello',
  };
  const stored = {
    id: 'm'.repeat(24),
    channelId: command.channelId,
    authorActorId: 'a'.repeat(24),
    sequence: 1,
    changeVersion: 1,
    text: command.text,
    createdAt: '2026-10-09T18:00:00.000Z',
    editedAt: null,
    removedAt: null,
  };
  const counters = {
    channelId: command.channelId,
    messageSequence: 0,
    changeVersion: 0,
  };
  const run = async (receipt: { messageId: string } | null) => {
    const calls: string[] = [];
    const state = receipt
      ? {
          counters,
          receipt: { ...receipt, payloadDigest: sendPayloadDigest(command) },
          existingMessage: stored,
          reply: null,
        }
      : { counters, receipt: null, existingMessage: null, reply: null };
    await sendMessagingMessage(
      command,
      { kind: 'user', userId: 'u'.repeat(24), actorId: 'a'.repeat(24) },
      {
        bounds: { messageUnits: 4000, pageItems: 100 },
        store: {
          readChannel: async (_input, work) =>
            work({
              readRequestState: async () => {
                calls.push('preflight');
                return { counters, receipt: state.receipt, message: null };
              },
            }),
          withChannel: async (_input, work) => {
            calls.push('transaction');
            return work({
              authorize: async () => {},
              readSendState: async () => state,
              commitSend: async () => {
                calls.push('commit');
              },
            });
          },
        },
        ids: { next: () => 'm'.repeat(24) },
        clock: { now: () => '2026-10-09T18:00:00.000Z' },
        limit: async () => {
          calls.push('limit');
        },
      },
    );
    return calls;
  };
  assert({
    given: 'a new request key, then a replay of a stored one',
    should:
      'spend the limiter before the transaction for the new key and never for the replay',
    actual: [await run(null), await run({ messageId: stored.id })],
    expected: [
      ['preflight', 'limit', 'transaction', 'commit'],
      ['preflight', 'transaction'],
    ],
  });
});
