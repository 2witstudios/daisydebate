import { type NotificationsQuery } from './notifications';
import { readNotificationItems } from './read-notifications';
import { spectatorClockAt } from '../spectating/spectator-clock';
import { requestApp } from '../../lib/page-reads';

const WATCH_HISTORY_ROWS = 50;

/** This account's stored notifications, as its list reads them. */
export const requestNotifications = (
  userId: string,
  query: NotificationsQuery,
) =>
  readNotificationItems(requestApp().database, {
    userId,
    query,
    now: requestApp().clock.now(),
  });

/** What this account keeps of its notification choices and watching. */
export const requestAudienceSettings = async (userId: string) => {
  const { database, clock } = requestApp();
  const [preferences, presentation, history, messageRequestSetting] =
    await Promise.all([
      database.readNotificationPreferences({ userId }),
      database.readNotificationPresentation({ userId }),
      database.listWatchHistory({
        userId,
        clock: spectatorClockAt(clock.now()),
        limit: WATCH_HISTORY_ROWS,
      }),
      database.readMessageRequestPolicy({ userId }),
    ]);
  return { preferences, presentation, history, messageRequestSetting };
};
