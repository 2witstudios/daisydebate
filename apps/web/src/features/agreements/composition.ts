import { defineComposition } from '../../server/composition';
import { createAppError } from '@daisy/errors';
import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import { agreementWords, contentWaiverAt } from '../legal/agreements';
import { createContentWaiverHandler } from './content-waiver-handler';

/** The agreement routes: a member's signature, recorded with its version. */
function composeAgreementRoutes(app: App) {
  return {
    contentWaiver: {
      POST: createContentWaiverHandler({
        logger: app.logger,
        reporter: app.reporter,
        origin: () => app.auth().config.PUBLIC_APP_URL,
        identify: (request) => identify(app.auth(), request.headers),
        readAgeBand: async (userId) =>
          (await app.auth().getParticipationByUserId(userId)).ageBand,
        limiter: () => app.limiter,
        sign: (userId, version, roomId) => {
          const waiver = contentWaiverAt(version);
          // The handler admits only a version served now.
          if (waiver === null)
            throw createAppError(
              'INVARIANT',
              'Admitted content waiver is missing',
            );
          return app.database.signContentWaiver({
            id: app.ids.next(),
            userId,
            roomId,
            version,
            words: agreementWords(waiver),
          });
        },
      }),
    },
  };
}

/** agreements: its route files bind here (`processRoute`). */
export const agreementComposition = defineComposition('agreements', (app) =>
  composeAgreementRoutes(app),
);
