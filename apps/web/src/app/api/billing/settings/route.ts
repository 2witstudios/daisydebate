import { processRoute } from '../../../../server/process-app';
import { billingRoutes } from '../../../../server/billing-app';
export const runtime = 'nodejs';
export const GET = processRoute(
  (_routes, app, fetch) => billingRoutes(app, fetch).settings.GET,
);
