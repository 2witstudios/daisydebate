import { defineComposition } from '../../server/composition';
import type { Waits } from '@daisy/clock';
import { passOf, pollWork } from '@daisy/worker';
import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import type { AccountRouteDeps } from '../../server/account-route';
import { createAudienceReactionRoute } from '../audience-reactions/handler';
import { createDebaterFollowRoute } from '../following/handler';
import { createSpectatorChatRoute } from '../messaging/spectator-chat/handler';
import {
  createNotificationPreferencesRoute,
  createNotificationPresentationRoute,
  createNotificationShellRoute,
  createNotificationsReadRoute,
} from '../notifications/handlers';
import { createUnsubscribeRoute } from '../notifications/email/unsubscribe-handler';
import { deriveUnsubscribeSubkey } from '../notifications/email/unsubscribe-token';
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
    notificationPresentation: createNotificationPresentationRoute({
      ...account,
      store,
    }),
    notificationShell: createNotificationShellRoute({
      ...account,
      store,
      clock,
    }),
    notificationUnsubscribe: createUnsubscribeRoute({
      store,
      subkey: () =>
        deriveUnsubscribeSubkey(app.mailConfig().RECIPIENT_HASH_SECRET),
      logger: app.logger,
    }),
  };
}

/** Notifications, on every web instance: each event's claim keeps it once. */
export const startNotificationSweep = (app: App, waits: Waits) => {
  const sweep = createNotificationSweep({
    store: app.database,
    now: () => app.clock.now(),
    nextId: () => app.ids.next(),
  });
  return pollWork({
    pass: () => sweep().then(passOf),
    // A fixed cadence: an event falls due by the spectator clock, not a
    // command, so followers hear within one pass of its release.
    backoff: {
      busyMs: NOTIFICATION_SWEEP_EVERY_MS,
      idleMaxMs: NOTIFICATION_SWEEP_EVERY_MS,
    },
    waits,
    failed: () =>
      app.logger.log('notifications.sweep_failed', {}, 'Notifications'),
  });
};

/** audience: its route files bind here (`processRoute`). */
export const audienceComposition = defineComposition('audience', (app) =>
  composeAudienceRoutes(app),
);
