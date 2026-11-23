import { processRoute } from '../../../../server/process-app';
import { billingComposition } from '../../../../features/billing/composition';
export const runtime = 'nodejs';
export const GET = processRoute(
  billingComposition,
  (routes) => routes.settings.GET,
);
