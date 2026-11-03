import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import { createContentWaiverHandler } from './content-waiver-handler';

/** The agreement routes: a member's signature, recorded with its version. */
export function composeAgreementRoutes(app: App) {
  return {
    contentWaiver: {
      POST: createContentWaiverHandler({
        logger: app.logger,
        reporter: app.reporter,
        origin: () => app.auth().config.PUBLIC_APP_URL,
        identify: (request) => identify(app.auth(), request.headers),
        limiter: () => app.limiter,
        sign: (userId, version) =>
          app.database.signContentWaiver({
            id: app.ids.next(),
            userId,
            version,
          }),
      }),
    },
  };
}
