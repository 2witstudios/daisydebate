import { identify } from '../../lib/identity';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';
import type { App } from '../../server/app';
import type { AccountRouteDeps } from '../../server/account-route';
import { createAudienceReactionRoute } from '../audience-reactions/handler';
import { createDebaterFollowRoute } from '../following/handler';
import { createSpectatorChatRoute } from '../messaging/spectator-chat/handler';
import {
  createNotificationPreferencesRoute,
  createNotificationsReadRoute,
} from '../notifications/handlers';
import { createNotificationSweep } from '../notifications/sweep';
import { createViewerPulseRoute } from '../viewer-counts/handler';
import { createWatchHistoryRoute } from '../watch-history/handler';
import { createAudienceSnapshotRoute } from './audience-snapshot';

const NOTIFICATION_SWEEP_EVERY_MS = 15_000;

/** The audience's routes, each from its owning feature. */
export function composeAudienceRoutes(app: App) {
  const account: AccountRouteDeps = {
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    identify: (request) => identify(app.auth(), request.headers),
    limiter: () => app.limiter,
  };
  const store = app.database;
  const { clock, ids } = app;
  return {
    snapshot: createAudienceSnapshotRoute({
      logger: app.logger,
      reporter: app.reporter,
      store,
      identify: account.identify,
    }),
    chat: createSpectatorChatRoute({ ...account, store, clock, ids }),
    reaction: createAudienceReactionRoute({ ...account, store, clock, ids }),
    viewerPulse: createViewerPulseRoute({
      logger: app.logger,
      reporter: app.reporter,
      origin: account.origin,
      limiter: account.limiter,
      clock,
      store,
      counts: app.redis,
    }),
    follow: createDebaterFollowRoute({ ...account, store }),
    watchHistory: createWatchHistoryRoute({ ...account, store, clock }),
    notificationsRead: createNotificationsReadRoute({
      ...account,
      store,
      clock,
    }),
    notificationPreferences: createNotificationPreferencesRoute({
      ...account,
      store,
    }),
  };
}

/** Notifications, on every web instance: each event's claim keeps it once. */
export const startNotificationSweep = (app: App, timers: WorkerTimers) =>
  startSingleFlightWorker({
    run: createNotificationSweep({
      store: app.database,
      now: () => app.clock.now(),
      nextId: () => app.ids.next(),
    }),
    everyMs: NOTIFICATION_SWEEP_EVERY_MS,
    timers,
    failed: () =>
      app.logger.log('notifications.sweep_failed', {}, 'Notifications'),
  });
