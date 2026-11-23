import type { NotificationsStore } from '@daisy/db/stores/notifications';
import type { Clock } from '@daisy/clock';
import {
  NOTIFICATIONS_SHELL_RECENT,
  notificationPreferencesSchema,
  notificationPresentationSchema,
  notificationShellSchema,
  notificationsReadSchema,
} from '@daisy/protocol/notifications';
import {
  accountRead,
  accountRoute,
  type AccountRouteDeps,
} from '../../server/account-route';
import { parseValidated } from '../../server/http';
import { canReadTournamentInbox } from './read-notifications';
import { notificationWords } from './notification-words';

const WRITE_LIMIT = { max: 120, windowSeconds: 3600 };

/** POST /api/notifications/read: marks some, or all, of the account's own. */
export const createNotificationsReadRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<NotificationsStore, 'markNotificationsRead'>;
    readonly clock: Pick<Clock, 'now'>;
  },
) =>
  accountRoute(
    deps,
    {
      operation: 'notifications.read',
      limit: WRITE_LIMIT,
      maxBodyBytes: 2048,
      refusals: [],
    },
    async ({ identity, body }) => {
      const read = parseValidated(notificationsReadSchema, body);
      await deps.store.markNotificationsRead({
        userId: identity.principal.userId,
        notificationIds: read.kind === 'some' ? read.notificationIds : 'all',
        at: deps.clock.now(),
      });
      return Response.json({ received: true });
    },
  );

/** POST /api/notifications/preferences: stores what the member chose (ISSUE-1045). */
export const createNotificationPreferencesRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<NotificationsStore, 'writeNotificationPreferences'>;
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

/** The shell reads after every ring, from each open tab: generous, still bounded. */
const SHELL_LIMIT = { max: 600, windowSeconds: 3600 };

/**
 * GET /api/notifications/shell (ADR 0144): the badge's unread count, the
 * newest unread notifications in the inbox's words, and how the member
 * chose to be told. The shell reads it when its inbox rings.
 */
export const createNotificationShellRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<
      NotificationsStore,
      'readNotifications' | 'readNotificationPresentation'
    >;
    readonly clock: Pick<Clock, 'now'>;
  },
) =>
  accountRead(
    deps,
    { operation: 'notifications.shell', limit: SHELL_LIMIT },
    async (identity) => {
      const userId = identity.principal.userId;
      const [inbox, presentation] = await Promise.all([
        deps.store.readNotifications({
          userId,
          canReadTournament: canReadTournamentInbox,
          unreadOnly: true,
          limit: NOTIFICATIONS_SHELL_RECENT,
          now: deps.clock.now(),
          after: null,
        }),
        deps.store.readNotificationPresentation({ userId }),
      ]);
      return Response.json(
        notificationShellSchema.parse({
          version: 1,
          unread: inbox.unread,
          recent: inbox.rows.map(
            ({ id, readAt: _read, surfacedAt, ...subject }) => ({
              id,
              kind: subject.kind,
              ...notificationWords(subject),
              surfacedAt,
            }),
          ),
          presentation,
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    },
  );

/** POST /api/notifications/presentation: how the member is told, and the email switch. */
export const createNotificationPresentationRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<NotificationsStore, 'writeNotificationPresentation'>;
  },
) =>
  accountRoute(
    deps,
    {
      operation: 'notifications.presentation',
      limit: WRITE_LIMIT,
      maxBodyBytes: 256,
      refusals: [],
    },
    async ({ identity, body }) => {
      const chosen = parseValidated(notificationPresentationSchema, body);
      await deps.store.writeNotificationPresentation({
        userId: identity.principal.userId,
        presentation: {
          toasts: chosen.toasts,
          sound: chosen.sound,
          desktopAlerts: chosen.desktopAlerts,
          email: chosen.email,
        },
      });
      return Response.json({ received: true });
    },
  );
