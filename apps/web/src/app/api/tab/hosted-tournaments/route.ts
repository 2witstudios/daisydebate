import { hostTiersReleasedFor } from '../../../../features/tab/route-release';
import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes, app) =>
  routes.hosting.home(hostTiersReleasedFor(app)).GET,
);
