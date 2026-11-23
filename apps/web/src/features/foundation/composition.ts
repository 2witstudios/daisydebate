import { defineComposition } from '../../server/composition';
import { createProofHandlers } from './handlers';

/** foundation-proof: its route files bind here (`processRoute`). */
export const foundationProofComposition = defineComposition(
  'foundation-proof',
  (app) =>
    createProofHandlers({
      enabled: app.config.FOUNDATION_PROOF_ENABLED,
      origin: app.config.PUBLIC_APP_URL,
      database: app.database,
      ids: app.ids,
      logger: app.logger,
      reporter: app.reporter,
    }),
);
