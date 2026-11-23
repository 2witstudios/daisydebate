import { tabReleasedFor } from '../../../../features/tab/route-release';
import { processRoute } from '../../../../server/process-app';
import { tabComposition } from '../../../../features/tab/composition';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(tabComposition, (routes, app) =>
  routes.lobbyPeople(tabReleasedFor(app)),
);
