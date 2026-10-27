import type { App } from '../../server/app';
import { mediaWorkerAuthentication } from '../../server/media-worker-ingress';
import { createBotActivityRelay } from './activity-relay';
import { createBotListenerHandlers } from './listener-handlers';

/** Inert without configuration; the router mounts only this authenticated handler. */
export function composeBotListenerRoutes(app: App) {
  return createBotListenerHandlers({
    logger: app.logger,
    authentication: mediaWorkerAuthentication(app),
    listener: () => app.database,
    activity: createBotActivityRelay({
      readListener: (identity) => app.database.readBotListenerState(identity),
      readLease: (identity) =>
        app.database.readCurrentBotListenerLease(identity),
      write: app.redis.writeBotActivity,
    }),
  });
}
