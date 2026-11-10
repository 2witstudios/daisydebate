import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import {
  notificationPreferencesSchema,
  notificationsReadSchema,
} from '@daisy/protocol';
import {
  accountRoute,
  type AccountRouteDeps,
} from '../../server/account-route';
import { parseValidated } from '../../server/http';

const WRITE_LIMIT = { max: 120, windowSeconds: 3600 };

/** POST /api/notifications/read: marks one, or all, of the account's own. */
export const createNotificationsReadRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<Database, 'markNotificationsRead'>;
    readonly clock: Pick<Clock, 'now'>;
  },
) =>
  accountRoute(
    deps,
    {
      operation: 'notifications.read',
      limit: WRITE_LIMIT,
      maxBodyBytes: 256,
      refusals: [],
    },
    async ({ identity, body }) => {
      const read = parseValidated(notificationsReadSchema, body);
      await deps.store.markNotificationsRead({
        userId: identity.principal.userId,
        notificationId: read.kind === 'one' ? read.notificationId : null,
        at: deps.clock.now(),
      });
      return Response.json({ received: true });
    },
  );

/** POST /api/notifications/preferences: stores what the member chose (ISSUE-1045). */
export const createNotificationPreferencesRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<Database, 'writeNotificationPreferences'>;
  },
) =>
  accountRoute(
    deps,
    {
      operation: 'notifications.preferences',
      limit: WRITE_LIMIT,
      maxBodyBytes: 1024,
      refusals: [],
    },
    async ({ identity, body }) => {
      const choice = parseValidated(notificationPreferencesSchema, body);
      await deps.store.writeNotificationPreferences({
        userId: identity.principal.userId,
        choices: choice.choices,
      });
      return Response.json({ received: true });
    },
  );
