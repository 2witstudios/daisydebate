import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import { createSupportHandlers } from './handlers';

/** Support's route, built from one app. */
export const composeSupportRoutes = (app: App) =>
  createSupportHandlers({
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.config.PUBLIC_APP_URL,
    identify: (request) => identify(app.auth(), request.headers),
    limiter: () => app.limiter,
    newId: () => app.ids.next(),
    store: app.database,
  });
