import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getNotifications } from './get-notifications';
import {
  notificationRows,
  notificationsHref,
  parseNotificationsQuery,
  type NotificationItem,
} from './notifications';

setupRitewayBun();

const item = (
  id: string,
  minutesAgo: number,
  unread: boolean,
): NotificationItem => ({ id, text: id, href: '/lobby', minutesAgo, unread });

const items = [
  item('a', 12, true),
  item('b', 190, true),
  item('c', 60 * 26, false),
];

describe('parseNotificationsQuery', () => {
  test('defaults and the unread filter', () => {
    assert({
      given: 'no parameters, then the unread filter',
      should: 'show everything, then unread only',
      actual: [
        parseNotificationsQuery({}),
        parseNotificationsQuery({ show: 'unread' }),
      ],
      expected: [{ unreadOnly: false }, { unreadOnly: true }],
    });
  });
});

describe('notificationsHref', () => {
  test('leaves defaults out', () => {
    assert({
      given: 'the default query and the unread filter',
      should: 'write only what differs',
      actual: [
        notificationsHref({ unreadOnly: false }),
        notificationsHref({ unreadOnly: true }),
      ],
      expected: ['/notifications', '/notifications?show=unread'],
    });
  });
});

describe('notificationRows', () => {
  test('unread only', () => {
    assert({
      given: 'the unread filter',
      should: 'drop the read ones',
      actual: notificationRows(items, { unreadOnly: true }).map(
        (row) => row.id,
      ),
      expected: ['a', 'b'],
    });
  });

  test('times in words', () => {
    assert({
      given: 'items 12 minutes, 190 minutes and 26 hours old',
      should: 'word them',
      actual: notificationRows(items, { unreadOnly: false }).map(
        (row) => row.when,
      ),
      expected: ['12 minutes ago', '3 hours ago', '1 day ago'],
    });
  });
});

describe('getNotifications', () => {
  test('nothing is stored yet', () => {
    assert({
      given: 'the page seam with no stored notifications',
      should: 'list nothing rather than a sample',
      actual: getNotifications({}),
      expected: { query: { unreadOnly: false }, rows: [], unread: 0 },
    });
  });

  test('stored items are counted', () => {
    assert({
      given: 'stored items and the unread filter',
      should: 'count every unread item and list only those',
      actual: [
        getNotifications({ show: 'unread' }, items).unread,
        getNotifications({ show: 'unread' }, items).rows.length,
      ],
      expected: [2, 2],
    });
  });
});
