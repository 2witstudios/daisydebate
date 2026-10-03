import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleNotifications } from '../../ui/mock/notifications';
import { getNotifications } from './get-notifications';
import {
  notificationRows,
  notificationsHref,
  parseNotificationsQuery,
} from './notifications';

setupRitewayBun();

describe('parseNotificationsQuery', () => {
  test('defaults and flags', () => {
    assert({
      given: 'no parameters, then both flags',
      should: 'show everything, then unread only with all read',
      actual: [
        parseNotificationsQuery({}),
        parseNotificationsQuery({ show: 'unread', read: 'all' }),
      ],
      expected: [
        { unreadOnly: false, allRead: false },
        { unreadOnly: true, allRead: true },
      ],
    });
  });
});

describe('notificationsHref', () => {
  test('leaves defaults out', () => {
    assert({
      given: 'the default query and a full one',
      should: 'write only what differs',
      actual: [
        notificationsHref({ unreadOnly: false, allRead: false }),
        notificationsHref({ unreadOnly: true, allRead: true }),
      ],
      expected: ['/notifications', '/notifications?show=unread&read=all'],
    });
  });
});

describe('notificationRows', () => {
  test('unread only', () => {
    assert({
      given: 'the unread filter',
      should: 'drop the read ones',
      actual: notificationRows(sampleNotifications, {
        unreadOnly: true,
        allRead: false,
      }).every((row) => row.unread),
      expected: true,
    });
  });

  test('all read', () => {
    assert({
      given: 'everything marked read with the unread filter on',
      should: 'leave nothing to show',
      actual: notificationRows(sampleNotifications, {
        unreadOnly: true,
        allRead: true,
      }),
      expected: [],
    });
  });

  test('times in words', () => {
    assert({
      given: 'items 12 minutes, 190 minutes and 26 hours old',
      should: 'word them',
      actual: notificationRows(sampleNotifications, {
        unreadOnly: false,
        allRead: false,
      })
        .map((row) => row.when)
        .slice(0, 4),
      expected: [
        '12 minutes ago',
        '45 minutes ago',
        '3 hours ago',
        '1 day ago',
      ],
    });
  });
});

describe('getNotifications', () => {
  test('unread count follows the read flag', () => {
    assert({
      given: 'the default view and all read',
      should: 'count three unread, then none',
      actual: [
        getNotifications({}).unread,
        getNotifications({ read: 'all' }).unread,
      ],
      expected: [3, 0],
    });
  });
});
