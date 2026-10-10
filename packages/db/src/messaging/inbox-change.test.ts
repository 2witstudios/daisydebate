import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AuthorizationTransaction } from '../authorization';
import { invalidateMessagingInboxes } from './inbox-change';
setupRitewayBun();
test('inbox invalidation validates the entire recipient set before I/O and deduplicates same-tx owner-only rows', async () => {
  const written: unknown[] = [];
  let notices = 0;
  const tx = {
    execute: async () => {
      notices += 1;
      return [];
    },
    insert: () => ({
      values: (value: unknown) => ({
        returning: async () => {
          written.push(value);
          return [{ seq: written.length, txid: '42' }];
        },
      }),
    }),
  } as unknown as AuthorizationTransaction;
  let refused = false;
  try {
    await invalidateMessagingInboxes(tx, ['a'.repeat(24), 'bad']);
  } catch {
    refused = true;
  }
  assert({
    given: 'an invalid recipient after a valid owner',
    should: 'refuse before inserting any partial notification',
    actual: [refused, written.length],
    expected: [true, 0],
  });
  const actorId = 'a'.repeat(24);
  await invalidateMessagingInboxes(tx, [actorId, actorId]);
  assert({
    given: 'the same owner twice in a caller transaction',
    should:
      'write one topic-bound bell and commit-dependent notification with no channel/content fields',
    actual: [written, notices],
    expected: [
      [
        {
          topic: `user:${actorId}:inbox`,
          kind: 'messaging.inbox.changed',
          version: 1,
          payload: { kind: 'messaging.inbox.changed' },
        },
      ],
      1,
    ],
  });
});
