import { defineComposition } from '../../server/composition';
import { createConsentHandler } from './handlers';

/** analytics-consent: its route file binds here (`processRoute`). */
export const analyticsConsentComposition = defineComposition(
  'analytics-consent',
  (app) => ({ POST: createConsentHandler(app) }),
);
