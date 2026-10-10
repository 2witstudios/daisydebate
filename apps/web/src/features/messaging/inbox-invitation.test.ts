import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { inspectMessagingInboxAssociation } from './inbox';
setupRitewayBun();
test('invitation candidates require their own current grant and never turn an outage into navigation', async () => {
  const channelId = 'g'.repeat(24);
  for (const code of [
    'AUTHORIZATION',
    'NOT_FOUND',
    'INFRASTRUCTURE',
  ] as const) {
    const calls: string[] = [];
    const inspect = () =>
      inspectMessagingInboxAssociation(channelId, {
        channel: async () => {
          calls.push('channel');
          throw createAppError(code);
        },
        invitation: async () => {
          calls.push('invitation');
        },
      });
    if (code === 'INFRASTRUCTURE')
      await assertRejects({
        given: 'current channel authority unavailable',
        should: 'refuse without probing invitation associations',
        actual: inspect,
        code,
      });
    else
      assert({
        given:
          'a content-denied candidate with fresh own pending invitation grant',
        should: 'return only invitation navigation',
        actual: await inspect(),
        expected: { channelId, kind: 'incoming_invitation' },
      });
    assert({
      given: code,
      should: 'call only the distinct authorized projections',
      actual: calls,
      expected:
        code === 'INFRASTRUCTURE' ? ['channel'] : ['channel', 'invitation'],
    });
  }
  await assertRejects({
    given: 'a stale invitation candidate',
    should: 'propagate its current denial without inventing an entry',
    actual: () =>
      inspectMessagingInboxAssociation(channelId, {
        channel: async () => {
          throw createAppError('AUTHORIZATION');
        },
        invitation: async () => {
          throw createAppError('NOT_FOUND');
        },
      }),
    code: 'NOT_FOUND',
  });
});
