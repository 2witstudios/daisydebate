import { hostTiersReleasedFor } from '../../../../features/tab/route-release';
import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute((routes, app) =>
  routes.hosting.checkout(hostTiersReleasedFor(app)).POST,
);
