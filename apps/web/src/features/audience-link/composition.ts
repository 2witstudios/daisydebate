import { identify } from '../../lib/identity';
import { defineComposition } from '../../server/composition';
import { createAudienceLinkHandlers } from './handlers';

/** audience-link: its route files bind here (`processRoute`). */
export const audienceLinkComposition = defineComposition(
  'audience-link',
  (app) =>
    createAudienceLinkHandlers({
      logger: app.logger,
      reporter: app.reporter,
      origin: () => app.auth().config.PUBLIC_APP_URL,
      identify: (request) => identify(app.auth(), request.headers),
      limiter: () => app.limiter,
      store: app.database,
    }),
);
