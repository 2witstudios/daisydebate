import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { MessagingGroupInvitationStore } from '@daisy/db/messaging';
import { readMessagingGroupInvitation } from './group-invitation';
setupRitewayBun();
test('invitation preview refuses private content and foreign scope before returning minimal metadata', async () => {
  const channelId = 'c'.repeat(24);
  const principal = {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'i'.repeat(24),
  };
  for (const extra of [
    { title: 'Private title' },
    { channelId: 'f'.repeat(24) },
  ]) {
    const store: MessagingGroupInvitationStore = {
      withInvitation: async (_scope, work) =>
        work({
          preview: async () => ({
            channelId,
            generation: 1,
            state: 'pending' as const,
            ...extra,
          }),
          readDecisionState: async () => {
            throw new Error('No decision read');
          },
          commitDecision: async () => {
            throw new Error('No decision write');
          },
        }),
    };
    await assertRejects({
      given: 'a corrupt protected preview projection',
      should: 'refuse without leaking content or another channel',
      actual: () =>
        readMessagingGroupInvitation({ version: 1, channelId }, principal, {
          store,
          bounds: { introductionUnits: 20, titleUnits: 20, batchActors: 3 },
        }),
      code: 'INFRASTRUCTURE',
    });
  }
  assert({
    given: 'the authenticated caller',
    should: 'remain unchanged by refused metadata projections',
    actual: principal.actorId,
    expected: 'i'.repeat(24),
  });
});
