import { hostTiersReleasedFor } from '../../../../features/tab/route-release';
import { processRoute } from '../../../../server/process-app';
import { hostingComposition } from '../../../../features/hosting-purchases/routes';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute(
  hostingComposition,
  (routes, app, fetch) =>
    routes.checkout(hostTiersReleasedFor(app), fetch).POST,
);
