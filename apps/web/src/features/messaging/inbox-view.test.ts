import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  appendPage,
  byAttention,
  type MessagingInboxEntry,
} from './inbox-view';

setupRitewayBun();
const row = (channelId: string, minute: number): MessagingInboxEntry => ({
  channelId,
  kind: 'conversation',
  title: channelId,
  preview: null,
  activityAt: `2026-11-04T10:${String(minute).padStart(2, '0')}:00.000Z`,
  unread: false,
});
const invitation = (channelId: string): MessagingInboxEntry => ({
  channelId,
  kind: 'incoming_invitation',
});
const ids = (entries: readonly MessagingInboxEntry[]) =>
  entries.map((entry) => entry.channelId);

describe('inbox view', () => {
  test('attention order', () => {
    assert({
      given: 'invitations, older and newer activity, and a tie',
      should: 'lead with invitations, then newest, tied by channel',
      actual: ids(
        [
          row('old', 1),
          invitation('z'),
          row('b', 5),
          row('a', 5),
          invitation('y'),
        ].sort(byAttention),
      ),
      expected: ['y', 'z', 'a', 'b', 'old'],
    });
  });
  test('a later page', () => {
    assert({
      given: 'a next page repeating a conversation that moved during paging',
      should: 'hold it once, in order',
      actual: appendPage(
        { entries: [row('a', 9), row('b', 8)], nextAfter: 'one' },
        { entries: [row('b', 8), row('c', 7)], nextAfter: null },
      ),
      expected: {
        entries: [row('a', 9), row('b', 8), row('c', 7)],
        nextAfter: null,
      },
    });
  });
});
