import { defineComposition } from '../../server/composition';
import type { App } from '../../server/app';
import { createLeagueRequestHandlers } from './handlers';

/** League requests' route, built from one app. */
const composeLeagueRequestRoutes = (app: App) =>
  createLeagueRequestHandlers({
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.config.PUBLIC_APP_URL,
    limiter: () => app.limiter,
    newId: () => app.ids.next(),
    store: app.database,
  });

/** league-requests: its route files bind here (`processRoute`). */
export const leagueRequestComposition = defineComposition(
  'league-requests',
  (app) => composeLeagueRequestRoutes(app),
);
