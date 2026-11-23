import { processRoute } from '../../../../server/process-app';
import { analyticsConsentComposition } from '../../../../features/analytics/composition';
export const runtime = 'nodejs';
export const POST = processRoute(
  analyticsConsentComposition,
  (routes) => routes.POST,
);
