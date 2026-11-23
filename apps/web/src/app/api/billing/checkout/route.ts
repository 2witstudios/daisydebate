import { processRoute } from '../../../../server/process-app';
import { billingComposition } from '../../../../features/billing/composition';
export const runtime = 'nodejs';
export const POST = processRoute(
  billingComposition,
  (routes) => routes.checkout.POST,
);
