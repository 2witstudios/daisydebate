import { leagueRequestsReleased } from '../../../features/league-requests/route-release';
import { processRoute } from '../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute((routes, app) =>
  routes.leagueRequests.POST(leagueRequestsReleased(app)),
);
