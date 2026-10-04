import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getNotifications } from '../../../features/notifications/get-notifications';
import { NotificationsPage } from './notifications-page';

setupRitewayBun();

const render = (params: Record<string, string>) =>
  renderToString(h(NotificationsPage, getNotifications(params)));

describe('NotificationsPage', () => {
  test('unread items offer to mark all read', () => {
    const html = render({});
    assert({
      given: 'unread notifications',
      should: 'link the mark-all control to the all-read state',
      actual: [
        html.includes('3 unread.'),
        html.includes('href="/notifications?read=all"'),
      ],
      expected: [true, true],
    });
  });

  test('all read', () => {
    const html = render({ read: 'all' });
    assert({
      given: 'everything marked read',
      should: 'say so and drop the control',
      actual: [
        html.includes('all caught up'),
        html.includes('Mark all as read'),
      ],
      expected: [true, false],
    });
  });

  test('unread filter when nothing is unread', () => {
    assert({
      given: 'the unread filter after marking all read',
      should: 'show the empty state',
      actual: render({ show: 'unread', read: 'all' }).includes('Nothing here.'),
      expected: true,
    });
  });
});
