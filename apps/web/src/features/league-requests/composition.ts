import type { App } from '../../server/app';
import { createRequestFlagReader } from '../flags/reader';
import { releaseFlagDefault } from '../flags/release-default';
import { createLeagueRequestHandlers } from './handlers';

/**
 * League requests' route, built from one app. The release is read afresh
 * for each request, for no account: the form is the same signed in or out.
 */
export const composeLeagueRequestRoutes = (app: App) =>
  createLeagueRequestHandlers({
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.config.PUBLIC_APP_URL,
    released: () =>
      createRequestFlagReader({
        read: app.database.readFlagSnapshot,
        now: () => Date.parse(app.clock.now()),
        diagnostic: () =>
          app.logger.log(
            'flags.read.failed',
            { operation: 'flags.read', cause: 'unavailable' },
            'Release control read failed',
          ),
        releaseDefault: releaseFlagDefault(app.config),
      })('league-requests', null),
    limiter: () => app.limiter,
    store: app.database,
  });
