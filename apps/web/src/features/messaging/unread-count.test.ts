import { assert, setupRitewayBun, test } from 'riteway/bun';
import { unreadConversationsOf } from './inbox-view';

setupRitewayBun();

const conversation = (channelId: string, unread: boolean) => ({
  channelId,
  kind: 'conversation' as const,
  title: null,
  preview: null,
  activityAt: '2026-11-16T12:00:00.000Z',
  unread,
});

test('unreadConversationsOf', () => {
  assert({
    given: 'two unread conversations, one read, and an invitation',
    should: 'count the three that wait on the member',
    actual: unreadConversationsOf([
      conversation('a', true),
      conversation('b', false),
      conversation('c', true),
      { channelId: 'd', kind: 'incoming_invitation' },
    ]),
    expected: 3,
  });
});
