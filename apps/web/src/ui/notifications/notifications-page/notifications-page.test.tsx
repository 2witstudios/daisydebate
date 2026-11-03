import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getNotifications } from '../../../features/notifications/get-notifications';
import { NotificationsPage } from './notifications-page';

setupRitewayBun();

const stored = [
  {
    id: 'a',
    text: 'A stored notification',
    href: '/lobby',
    minutesAgo: 5,
    unread: true,
  },
];

const render = (
  params: Record<string, string>,
  items: Parameters<typeof getNotifications>[1] = [],
) => renderToString(h(NotificationsPage, getNotifications(params, items)));

describe('NotificationsPage', () => {
  test('nothing stored', () => {
    const html = render({});
    assert({
      given: 'no stored notifications',
      should: 'say so, with no sample row and no mark-all control',
      actual: [
        html.includes('all caught up'),
        html.includes('Nothing here.'),
        html.includes('Mark all'),
      ],
      expected: [true, true, false],
    });
  });

  test('a stored notification', () => {
    const html = render({}, stored);
    assert({
      given: 'one unread stored notification',
      should: 'count it and link it',
      actual: [
        html.includes('1 unread.'),
        html.includes('A stored notification'),
        html.includes('href="/lobby"'),
      ],
      expected: [true, true, true],
    });
  });
});
