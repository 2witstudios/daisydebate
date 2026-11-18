import type { App } from '../../server/app';
import { createLeagueRequestHandlers } from './handlers';

/** League requests' route, built from one app. */
export const composeLeagueRequestRoutes = (app: App) =>
  createLeagueRequestHandlers({
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.config.PUBLIC_APP_URL,
    limiter: () => app.limiter,
    store: app.database,
  });
