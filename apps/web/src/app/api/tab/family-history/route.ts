import { tabMinorsReleasedFor } from '../../../../features/tab/route-release';
import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes, app) =>
  routes.tab.familyHistory(tabMinorsReleasedFor(app)),
);
