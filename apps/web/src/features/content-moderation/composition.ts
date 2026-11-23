import { defineComposition } from '../../server/composition';
import { identify } from '../auth/identity';
import type { App } from '../../server/app';
import { createReportHandler } from './report-handler';

/** The participant's one moderation route: filing a report. */
function composeContentModerationRoutes(app: App) {
  return {
    report: {
      POST: createReportHandler({
        logger: app.logger,
        reporter: app.reporter,
        origin: () => app.auth().config.PUBLIC_APP_URL,
        identify: (request) => identify(app.auth(), request.headers),
        limiter: () => app.limiter,
        store: app.database,
        nextId: () => app.ids.next(),
      }),
    },
  };
}

/** content-moderation: its route files bind here (`processRoute`). */
export const contentModerationComposition = defineComposition(
  'content-moderation',
  (app) => composeContentModerationRoutes(app),
);
