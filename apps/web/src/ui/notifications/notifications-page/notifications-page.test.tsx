import { idle } from '../../../features/forms/form-state';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
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
) =>
  renderAccessible(
    h(
      AppRouterContext,
      { value: {} as never },
      h(NotificationsPage, {
        ...getNotifications(
          params,
          items,
          items.filter((item) => item.unread).length,
        ),
        markRead: () => async () => idle(),
        markAllRead: async () => idle(),
      }),
    ),
  );

describe('NotificationsPage', () => {
  test('nothing stored', () => {
    const view = render({});
    assert({
      given: 'no stored notifications',
      should: 'say so, with no sample row and no mark-all control',
      actual: [
        view.textContent().includes('all caught up'),
        view.textContent().includes('Nothing here.'),
        view.names('button').filter((name) => name.includes('Mark all')),
      ],
      expected: [true, true, []],
    });
  });

  test('a stored notification', () => {
    const view = render({}, stored);
    assert({
      given: 'one unread stored notification',
      should: 'count it and link it',
      actual: [
        view.textContent().includes('1 unread.'),
        view.attribute('link', 'A stored notification', 'href'),
      ],
      expected: [true, '/lobby'],
    });
  });
});
