import { leagueRequestsReleased } from '../../../features/league-requests/route-release';
import { processRoute } from '../../../server/process-app';
import { leagueRequestComposition } from '../../../features/league-requests/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute(leagueRequestComposition, (routes, app) =>
  routes.POST(leagueRequestsReleased(app)),
);
