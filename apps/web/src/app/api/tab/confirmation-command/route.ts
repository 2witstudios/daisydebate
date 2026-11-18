import { tabReleasedFor } from '../../../../features/tab/route-release';
import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute((routes, app) =>
  routes.tab.confirmationCommand(tabReleasedFor(app)),
);
