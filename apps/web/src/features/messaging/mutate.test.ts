import { createHash } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  MessagingChannelStore,
  MessagingMutationState,
} from '@daisy/db/messaging';
import { mutateMessagingMessage } from './mutate';

setupRitewayBun();

const actorId = 'a'.repeat(24),
  channelId = 'c'.repeat(24),
  messageId = 'm'.repeat(24),
  now = '2026-10-09T18:00:30.000Z';
const command = {
  version: 1,
  channelId,
  requestId: 'r'.repeat(24),
  messageId,
  text: 'Edited',
};
const digest = createHash('sha3-256')
  .update(JSON.stringify([1, 'edit', messageId, command.text]))
  .digest('hex');
const message = {
  id: messageId,
  channelId,
  authorActorId: actorId,
  sequence: 1,
  changeVersion: 1,
  text: 'Original',
  createdAt: '2026-10-09T18:00:00.000Z',
  editedAt: null,
  removedAt: null,
};
const counters = { channelId, messageSequence: 1, changeVersion: 1 };

/** The calls one edit makes when its preflight and transaction see `state`. */
async function edit(state: MessagingMutationState) {
  const calls: string[] = [];
  const store = {
    readChannel: async (_scope, work) =>
      work({
        readRequestState: async () => {
          calls.push('preflight');
          return state;
        },
      } as never),
    withChannel: async (_scope, work) => {
      calls.push('transaction');
      return work({
        readMutationState: async () => state,
        commitMutation: async () => {
          calls.push('commit');
        },
      } as never);
    },
  } as MessagingChannelStore;
  await mutateMessagingMessage(
    'edit',
    command,
    { kind: 'user', userId: 'u'.repeat(24), actorId },
    {
      bounds: { messageUnits: 4000, pageItems: 100 },
      editWindowMs: 60_000,
      store,
      clock: { now: () => now },
      limit: async () => {
        calls.push('limit');
      },
    },
  ).catch(() => calls.push('refused'));
  return calls;
}

test('an edit spends the limiter before its transaction, never for a replay, and never for a refused operation (MSG-2.2-arch1)', async () => {
  assert({
    given: 'a new edit, its replay, and an edit of another author’s message',
    should:
      'limit the new edit outside the transaction, skip the limiter on replay, and refuse the foreign edit before the limiter',
    actual: [
      await edit({ message, receipt: null, counters }),
      await edit({
        message: { ...message, text: command.text, changeVersion: 2 },
        receipt: { messageId, payloadDigest: digest },
        counters,
      }),
      await edit({
        message: { ...message, authorActorId: 'b'.repeat(24) },
        receipt: null,
        counters,
      }),
    ],
    expected: [
      ['preflight', 'limit', 'transaction', 'commit'],
      ['preflight', 'transaction'],
      ['preflight', 'refused'],
    ],
  });
});
