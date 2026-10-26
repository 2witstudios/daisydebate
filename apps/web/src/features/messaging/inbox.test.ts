import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import {
  messagingInboxExcerpt,
  readMessagingInbox,
  summarizeMessagingInboxEntry,
} from './inbox';
setupRitewayBun();
const summary = (channelId: string, activityAt: string) => ({
  channelId,
  kind: 'conversation' as const,
  title: 'kelvin',
  preview: null,
  activityAt,
  unread: false,
});
test('inbox reauthorizes each candidate and propagates infrastructure failure instead of empty history', async () => {
  const ids = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)] as const;
  const inspected: string[] = [];
  const port = {
    candidates: async () => ids,
    inspect: async (channelId: string) => {
      inspected.push(channelId);
      if (channelId === ids[1]) throw createAppError('AUTHORIZATION');
      return summary(channelId, '2026-10-01T00:00:00.000Z');
    },
  };
  assert({
    given: 'a removed entitlement among own candidate IDs',
    should:
      'omit it while inspecting every candidate freshly and advancing the discovery cursor',
    actual: await readMessagingInbox({ limit: 3 }, port),
    expected: {
      entries: [
        summary(ids[0], '2026-10-01T00:00:00.000Z'),
        summary(ids[2], '2026-10-01T00:00:00.000Z'),
      ],
      nextAfter: ids[2],
    },
  });
  assert({
    given: 'candidate IDs',
    should: 'never become automatic grants',
    actual: inspected,
    expected: [...ids],
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

test('inbox entries lead with invitations, then the newest activity', async () => {
  const [a, b, c] = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)];
  const entries = {
    [a]: summary(a, '2026-10-01T00:00:00.000Z'),
    [b]: summary(b, '2026-10-03T00:00:00.000Z'),
    [c]: { channelId: c, kind: 'incoming_invitation' as const },
  };
  const page = await readMessagingInbox(
    { limit: 5 },
    {
      candidates: async () => [a, b, c],
      inspect: async (channelId: string) => entries[channelId]!,
    },
  );
  assert({
    given: 'an older conversation, a newer one and a pending invitation',
    should: 'order the invitation first and then newest activity first',
    actual: page.entries.map((entry) => entry.channelId),
    expected: [c, b, a],
  });
});
test('summaries prefer the newest message, then the request introduction', () => {
  const base = {
    title: 'kelvin',
    lastMessage: null,
    introduction: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    unread: false,
  };
  const channelId = 'c'.repeat(24);
  assert({
    given: 'a conversation with a newest message',
    should: 'preview that message at its time',
    actual: summarizeMessagingInboxEntry(channelId, 'conversation', {
      ...base,
      lastMessage: {
        text: 'Good round\n\nthanks',
        fromSelf: true,
        createdAt: '2026-10-02T00:00:00.000Z',
      },
      unread: true,
    }),
    expected: {
      channelId,
      kind: 'conversation',
      title: 'kelvin',
      preview: { text: 'Good round thanks', fromSelf: true },
      activityAt: '2026-10-02T00:00:00.000Z',
      unread: true,
    },
  });
  assert({
    given: 'a request without an introduction',
    should: 'show no preview and date it by the request',
    actual: summarizeMessagingInboxEntry(channelId, 'incoming_request', {
      ...base,
      introduction: {
        text: null,
        fromSelf: false,
        requestedAt: '2026-10-05T00:00:00.000Z',
      },
      unread: true,
    }),
    expected: {
      channelId,
      kind: 'incoming_request',
      title: 'kelvin',
      preview: null,
      activityAt: '2026-10-05T00:00:00.000Z',
      unread: true,
    },
  });
  assert({
    given: 'an empty new group',
    should: 'date it by its creation',
    actual: summarizeMessagingInboxEntry(channelId, 'group_conversation', {
      ...base,
      title: 'Policy club',
    }).activityAt,
    expected: '2026-10-01T00:00:00.000Z',
  });
});
test('excerpts are one bounded line', () => {
  const long = messagingInboxExcerpt('word '.repeat(60)) ?? '';
  assert({
    given: 'a message longer than the preview bound',
    should: 'cut it within the bound and mark the cut',
    actual: [long.length <= 120, long.endsWith('…')],
    expected: [true, true],
  });
  const emoji = messagingInboxExcerpt('😀'.repeat(100)) ?? '';
  assert({
    given: 'astral characters at the cut',
    should: 'never split a surrogate pair',
    actual: [emoji.length <= 120, /\uD83D(?!\uDE00)/.test(emoji)],
    expected: [true, false],
  });
  assert({
    given: 'whitespace only',
    should: 'yield no excerpt',
    actual: messagingInboxExcerpt(' \n '),
    expected: null,
  });
});
