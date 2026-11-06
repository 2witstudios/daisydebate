import { processRoute } from '../../../../server/process-app';
import { billingRoutes } from '../../../../server/billing-app';
export const runtime = 'nodejs';
export const POST = processRoute(
  (_routes, app, fetch) => billingRoutes(app, fetch).checkout.POST,
);
