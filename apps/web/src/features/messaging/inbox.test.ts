import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { readMessagingInbox } from './inbox';
setupRitewayBun();
test('inbox reauthorizes each candidate and propagates infrastructure failure instead of empty history', async () => {
  const ids = ['a', 'b', 'c'].map((prefix) => prefix.repeat(24));
  const inspected: string[] = [];
  const port = {
    candidates: async () => ids,
    inspect: async (channelId: string) => {
      inspected.push(channelId);
      if (channelId === ids[1]) throw createAppError('AUTHORIZATION');
      return { channelId, kind: 'conversation' as const };
    },
  };
  assert({
    given: 'a removed entitlement among own candidate IDs',
    should:
      'omit it while inspecting every candidate freshly and advancing the discovery cursor',
    actual: await readMessagingInbox({ limit: 3 }, port),
    expected: {
      entries: [
        { channelId: ids[0], kind: 'conversation' },
        { channelId: ids[2], kind: 'conversation' },
      ],
      nextAfter: ids[2],
    },
  });
  assert({
    given: 'candidate IDs',
    should: 'never become automatic grants',
    actual: inspected,
    expected: ids,
  });
  const { assertRejects } = await import('@daisy/errors/testing');
  await assertRejects({
    given: 'a policy/authority infrastructure outage',
    should: 'refuse the inbox rather than fabricate an empty result',
    code: 'INFRASTRUCTURE',
    actual: () =>
      readMessagingInbox(
        { limit: 3 },
        {
          ...port,
          inspect: async () => {
            throw createAppError('INFRASTRUCTURE');
          },
        },
      ),
  });
});
